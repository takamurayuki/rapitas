#!/usr/bin/env node
/**
 * check-determinism
 *
 * CI guard for the 8-point checklist in docs/reproducibility.md (item 8:
 * "CI guard"). Scans the prompt-critical directories — services/memory,
 * services/workflow, services/agents, services/ai, routes/agents — for
 * source patterns that historically reintroduced non-determinism into an
 * agent's prompt-visible context:
 *
 *   1. `.findMany(` calls whose options object has no `orderBy` (unordered
 *      DB reads feeding a prompt can silently reshuffle on tied sort keys).
 *   2. Direct-SDK calls (`.messages.create(`, `.chat.completions.create(`,
 *      `generateContent(`) under services/ with no `temperature` set, and
 *      any `temperature:` literal pinned to a non-zero value.
 *   3. `Date.now()` / `new Date(` / `Math.random()` / `crypto.randomUUID()`
 *      inside prompt-text-builder files (name matches `*prompt*builder*`
 *      or `*-prompt-*`) — wall-clock/random values must never shape prompt
 *      text or which content gets selected.
 *   4. `.findFirst(` calls whose options object has no `orderBy` (an
 *      unordered pick-one read is the riskiest case of all — ties are
 *      resolved by DB whim rather than by an explicit rule). Best-effort:
 *      many findFirst calls filter on a unique field and are already
 *      deterministic without an orderBy; false positives are expected and
 *      carry the same suppress-with-a-comment tradeoff as rule 1.
 *   5. `.sort((a, b) => single-expr)` calls whose comparator body is a bare
 *      subtraction (score difference) or localeCompare with no fallback
 *      operator for a secondary key — this exact shape reshuffled ties
 *      across otherwise-identical runs in an earlier fix pass. Only flags
 *      single-expression arrow comparators; block-bodied comparators are
 *      too varied to judge heuristically and are skipped.
 *
 * This is a dependency-free heuristic (fs + regex over source text, no
 * TypeScript parser), so it can run in CI with zero install step and will
 * have false positives — non-prompt-feeding queries/calls that happen to
 * live in a scanned directory, and (since it is not comment-aware) plain
 * comment text that happens to contain a stray quote character. Suppress a
 * single-line false positive with an opt-out comment on the line directly
 * above the flagged line:
 *
 *   // determinism-ok: <reason>
 *
 * Usage:
 *   node scripts/check-determinism.cjs              # lenient: warnings, exit 0
 *   node scripts/check-determinism.cjs --strict      # CI gate: exit 1 on any finding
 *   node scripts/check-determinism.cjs --json        # machine-readable output
 *   node scripts/check-determinism.cjs --strict --json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIRS = [
  'services/memory',
  'services/workflow',
  'services/agents',
  'services/ai',
  'routes/agents',
];

// CLI-driven agent runners have no temperature/seed control from this
// codebase (see docs/reproducibility.md "Accepted structural residual") —
// exempt from the temperature checks (rule 2), not from the prompt-text
// wall-clock/random check (rule 3), which still applies to their prompt
// builders.
const CLI_RUNNER_PATH_SEGMENTS = [
  path.join('claude-code', ''),
  path.join('codex-cli-agent', ''),
  path.join('gemini-cli-agent', ''),
];
const CLI_RUNNER_FILENAMES = new Set([
  'claude-code-agent.ts',
  'codex-cli-agent.ts',
  'gemini-cli-agent.ts',
]);

const STRICT = process.argv.includes('--strict');
const JSON_OUTPUT = process.argv.includes('--json');

const OPT_OUT_RE = /determinism-ok\s*:/;

/** Recursively collect .ts files under dir (relative to ROOT), skipping node_modules/dot-dirs and test/generated files. */
function collectTsFiles(absDir) {
  const results = [];
  if (!fs.existsSync(absDir)) return results;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.guards.generated.ts')
    ) {
      results.push(full);
    }
  }
  return results;
}

/** Relative path from ROOT, forward-slash normalized, for display. */
function rel(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

/** Line number (1-based) of a character offset in `content`. */
function lineAt(content, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') line++;
  }
  return line;
}

/** Text of the source line immediately above the given line number (1-based), or ''. */
function lineAbove(content, lineNo) {
  const lines = content.split('\n');
  return lineNo >= 2 ? lines[lineNo - 2] : '';
}

/** True if the line above `lineNo` carries a `// determinism-ok:` opt-out. */
function isSuppressed(content, lineNo) {
  return OPT_OUT_RE.test(lineAbove(content, lineNo));
}

/**
 * Given content and the index right after an opening `(`, find the index of
 * its matching closing `)`, tracking nested (), {}, [], strings, and
 * template literals so commas/braces inside them don't confuse the count.
 *
 * @returns index of the matching `)`, or -1 if unbalanced/not found.
 */
function findMatchingParen(content, openParenIdx) {
  let depth = 1;
  let i = openParenIdx + 1;
  let inString = null; // one of ', ", ` or null
  while (i < content.length && depth > 0) {
    const ch = content[i];
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

/** True if `absPath` is one of the CLI-runner files/dirs exempt from temperature rules. */
function isCliRunnerPath(absPath) {
  const relPath = rel(absPath);
  const filename = path.basename(absPath);
  if (CLI_RUNNER_FILENAMES.has(filename)) return true;
  return CLI_RUNNER_PATH_SEGMENTS.some((seg) => relPath.split('/').includes(seg.replace(/[\\/]/g, '')));
}

// ── Rule 1: findMany(...) missing orderBy ──────────────────────────────────

function checkFindManyOrdering(files) {
  const findings = [];
  const CALL_RE = /\.findMany\s*\(/g;
  for (const absPath of files) {
    const content = fs.readFileSync(absPath, 'utf8');
    let match;
    CALL_RE.lastIndex = 0;
    while ((match = CALL_RE.exec(content))) {
      const openParenIdx = match.index + match[0].length - 1;
      const closeParenIdx = findMatchingParen(content, openParenIdx);
      const callLine = lineAt(content, match.index);
      if (isSuppressed(content, callLine)) continue;
      const argsText =
        closeParenIdx === -1 ? content.slice(openParenIdx + 1, openParenIdx + 400) : content.slice(openParenIdx + 1, closeParenIdx);
      if (!/\borderBy\s*:/.test(argsText)) {
        findings.push({
          file: rel(absPath),
          line: callLine,
          rule: 'findMany-no-orderby',
          message: `findMany(...) call has no 'orderBy' — unordered result may feed a prompt inconsistently across runs.`,
        });
      }
    }
  }
  return findings;
}

// ── Rule 2a: temperature: <non-zero literal> ────────────────────────────────

function checkNonZeroTemperature(files) {
  const findings = [];
  const TEMP_RE = /\btemperature\s*:\s*(-?\d+(?:\.\d+)?)/g;
  for (const absPath of files) {
    const content = fs.readFileSync(absPath, 'utf8');
    let match;
    TEMP_RE.lastIndex = 0;
    while ((match = TEMP_RE.exec(content))) {
      const value = parseFloat(match[1]);
      if (value === 0) continue;
      const line = lineAt(content, match.index);
      if (isSuppressed(content, line)) continue;
      findings.push({
        file: rel(absPath),
        line,
        rule: 'nonzero-temperature',
        message: `temperature pinned to ${match[1]} (non-zero) — sampling is not deterministic. Use 0 unless this path is intentionally exploratory.`,
      });
    }
  }
  return findings;
}

// ── Rule 2b: provider .create()/generateContent() call site missing temperature ──

function checkProviderCallsMissingTemperature(files) {
  const findings = [];
  const CALL_RE = /\.(messages\.create|chat\.completions\.create)\s*\(|(?<![\w.])generateContent\s*\(/g;
  for (const absPath of files) {
    if (isCliRunnerPath(absPath)) continue;
    const content = fs.readFileSync(absPath, 'utf8');
    let match;
    CALL_RE.lastIndex = 0;
    while ((match = CALL_RE.exec(content))) {
      const openParenIdx = match.index + match[0].length - 1;
      const closeParenIdx = findMatchingParen(content, openParenIdx);
      const callLine = lineAt(content, match.index);
      if (isSuppressed(content, callLine)) continue;
      const argsText =
        closeParenIdx === -1 ? content.slice(openParenIdx + 1, openParenIdx + 400) : content.slice(openParenIdx + 1, closeParenIdx);
      if (!/\btemperature\s*:/.test(argsText) && !/\.\.\./.test(argsText)) {
        // No literal `temperature:` key AND no spread (`...config`) that could
        // be carrying one in from elsewhere — best-effort; a spread is treated
        // as "can't tell statically" and is not flagged.
        findings.push({
          file: rel(absPath),
          line: callLine,
          rule: 'provider-call-no-temperature',
          message: `Provider call has no explicit 'temperature' — sampling defaults to the provider's non-deterministic default.`,
        });
      }
    }
  }
  return findings;
}

// ── Rule 3: wall-clock/random leaks inside prompt-builder files ────────────

function isPromptBuilderFile(absPath) {
  const base = path.basename(absPath).toLowerCase();
  return /prompt.*builder/.test(base) || /-prompt-/.test(base);
}

function checkPromptBuilderNonDeterminism(files) {
  const findings = [];
  const LEAK_RE = /Date\.now\s*\(\s*\)|new\s+Date\s*\(|Math\.random\s*\(\s*\)|crypto\.randomUUID\s*\(\s*\)/g;
  for (const absPath of files) {
    if (!isPromptBuilderFile(absPath)) continue;
    const content = fs.readFileSync(absPath, 'utf8');
    let match;
    LEAK_RE.lastIndex = 0;
    while ((match = LEAK_RE.exec(content))) {
      const line = lineAt(content, match.index);
      if (isSuppressed(content, line)) continue;
      findings.push({
        file: rel(absPath),
        line,
        rule: 'prompt-builder-wallclock-random',
        message: `'${match[0]}' inside a prompt-builder file — wall-clock/random values must not shape prompt text.`,
      });
    }
  }
  return findings;
}

// ── Rule 4: findFirst(...) missing orderBy ─────────────────────────────────

function checkFindFirstOrdering(files) {
  const findings = [];
  const CALL_RE = /\.findFirst\s*\(/g;
  for (const absPath of files) {
    const content = fs.readFileSync(absPath, 'utf8');
    let match;
    CALL_RE.lastIndex = 0;
    while ((match = CALL_RE.exec(content))) {
      const openParenIdx = match.index + match[0].length - 1;
      const closeParenIdx = findMatchingParen(content, openParenIdx);
      const callLine = lineAt(content, match.index);
      if (isSuppressed(content, callLine)) continue;
      const argsText =
        closeParenIdx === -1 ? content.slice(openParenIdx + 1, openParenIdx + 400) : content.slice(openParenIdx + 1, closeParenIdx);
      if (!/\borderBy\s*:/.test(argsText)) {
        findings.push({
          file: rel(absPath),
          line: callLine,
          rule: 'findFirst-no-orderby',
          message: `findFirst(...) call has no 'orderBy' — the single row picked may vary run to run when the filter isn't unique.`,
        });
      }
    }
  }
  return findings;
}

// ── Rule 5: .sort(...) comparator with no secondary tiebreak key ──────────

/**
 * True if `body` (the arrow-function comparator body, single-expression
 * form only) reads as a bare subtraction or `.localeCompare(...)` result
 * with no `||` fallback carrying a secondary key.
 *
 * @param body - Comparator body source text / コンパレータ本体のソース
 * @returns Whether the body looks like a single-key comparator / 単一キー比較かどうか
 */
function looksLikeSingleKeyComparator(body) {
  if (/\|\|/.test(body)) return false; // already has a fallback key
  const isSubtraction = /^[^{}]*[)\w\]]\s*-\s*[\w$][\w$.[\]]*\s*;?\s*$/.test(body);
  const isLocaleCompare = /\.localeCompare\s*\(/.test(body);
  return isSubtraction || isLocaleCompare;
}

function checkSortMissingTiebreak(files) {
  const findings = [];
  const CALL_RE = /\.sort\s*\(/g;
  for (const absPath of files) {
    const content = fs.readFileSync(absPath, 'utf8');
    let match;
    CALL_RE.lastIndex = 0;
    while ((match = CALL_RE.exec(content))) {
      const openParenIdx = match.index + match[0].length - 1;
      const closeParenIdx = findMatchingParen(content, openParenIdx);
      if (closeParenIdx === -1) continue;
      const callLine = lineAt(content, match.index);
      if (isSuppressed(content, callLine)) continue;
      const argsText = content.slice(openParenIdx + 1, closeParenIdx).trim();
      // Only single-expression arrow comparators, e.g. `(a, b) => b.x - a.x`
      // — a block body `(a, b) => { ... }` can hide a secondary key in a
      // `return` statement and is too varied to judge heuristically here.
      const arrowMatch = argsText.match(/^\(?\s*[^,(){}]+\s*,\s*[^,(){}]+\)?\s*=>\s*([\s\S]+)$/);
      if (!arrowMatch) continue;
      const body = arrowMatch[1].trim();
      if (body.startsWith('{')) continue;
      if (looksLikeSingleKeyComparator(body)) {
        findings.push({
          file: rel(absPath),
          line: callLine,
          rule: 'sort-single-key-comparator',
          message: `.sort(...) comparator has no secondary tiebreak ('||' fallback) — ties may reorder inconsistently across runs.`,
        });
      }
    }
  }
  return findings;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const files = TARGET_DIRS.flatMap((d) => collectTsFiles(path.join(ROOT, d)));

  const findManyFindings = checkFindManyOrdering(files);
  const tempLiteralFindings = checkNonZeroTemperature(files);
  const providerCallFindings = checkProviderCallsMissingTemperature(files);
  const promptBuilderFindings = checkPromptBuilderNonDeterminism(files);
  const findFirstFindings = checkFindFirstOrdering(files);
  const sortTiebreakFindings = checkSortMissingTiebreak(files);

  const byRule = {
    'findMany-no-orderby': findManyFindings,
    'nonzero-temperature': tempLiteralFindings,
    'provider-call-no-temperature': providerCallFindings,
    'prompt-builder-wallclock-random': promptBuilderFindings,
    'findFirst-no-orderby': findFirstFindings,
    'sort-single-key-comparator': sortTiebreakFindings,
  };

  const all = [
    ...findManyFindings,
    ...tempLiteralFindings,
    ...providerCallFindings,
    ...promptBuilderFindings,
    ...findFirstFindings,
    ...sortTiebreakFindings,
  ];
  all.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));

  const summary = {
    filesScanned: files.length,
    total: all.length,
    byRule: Object.fromEntries(Object.entries(byRule).map(([k, v]) => [k, v.length])),
    strict: STRICT,
  };

  if (JSON_OUTPUT) {
    console.log(JSON.stringify({ summary, findings: all }, null, 2));
  } else {
    const label = STRICT ? 'FAIL-ON-FINDING (strict)' : 'advisory (lenient)';
    console.log(`[check-determinism] mode: ${label}`);
    console.log(`[check-determinism] scanned ${files.length} files across: ${TARGET_DIRS.join(', ')}`);
    console.log('');
    for (const [rule, findings] of Object.entries(byRule)) {
      console.log(`── ${rule} (${findings.length}) ${'─'.repeat(Math.max(0, 40 - rule.length))}`);
      for (const f of findings) {
        console.log(`  ${f.file}:${f.line}  ${f.message}`);
      }
      if (findings.length === 0) console.log('  (none)');
      console.log('');
    }
    console.log(
      `[check-determinism] total findings: ${all.length} (suppress a false positive with '// determinism-ok: <reason>' on the line above).`,
    );
  }

  if (STRICT && all.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
