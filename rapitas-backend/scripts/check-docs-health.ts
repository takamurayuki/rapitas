/**
 * check-docs-health
 *
 * Scans docs/ for three categories of health violations:
 *
 *   Domain 1 (Broken links): Backtick path references inside docs that resolve
 *             to files that no longer exist on disk.
 *
 *   Domain 2 (Duplicates): Pairs of docs files where at least one has an
 *             auto-generated header and their Jaccard line-similarity is ≥ 0.7.
 *             Signals a double-managed document that has drifted from its
 *             auto-generated counterpart.
 *
 *   Domain 3 (Orphans): Docs with a broken-link rate > 50%, suggesting the
 *             document references a deleted subsystem. Always warn-only —
 *             this is a heuristic and docs without TS source references are
 *             normal for design/architecture documents.
 *
 * Usage:
 *   bun scripts/check-docs-health.ts              # warn-only (default), exit 0
 *   bun scripts/check-docs-health.ts --check      # strict mode, exit 1 on violation (1-2 only)
 *   bun scripts/check-docs-health.ts --warn-only  # explicit warn-only, exit 0
 *
 * The --check flag is intended for CI after the known violations are resolved.
 * Domain 3 (Orphans) is permanently warn-only regardless of mode.
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');
const DOCS_DIR = join(ROOT, 'docs');

const CHECK_MODE = process.argv.includes('--check');
const WARN_ONLY = process.argv.includes('--warn-only') || !CHECK_MODE;

// NOTE: Jaccard similarity threshold for duplicate detection.
//       At 0.7 the boundary-values-guide.md × boundary-guide.generated.md pair
//       (near-identical content) is captured while unrelated docs score below it.
const JACCARD_THRESHOLD = 0.7;

// Marker string present in docs managed by `bun gen:*` scripts.
const AUTO_GEN_MARKER = '自動生成ファイル';

// File extensions considered "code file" references worth checking for existence.
const CODE_EXTENSIONS = /\.(ts|tsx|rs|md|js|jsx|json|cjs|mjs|prisma|py|sh)$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Reads a file, returning empty string on any error.
 *
 * @param path - Absolute path to read.
 * @returns File content or ''.
 */
function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Returns a display-friendly path relative to ROOT, normalized to forward slashes.
 *
 * @param path - Absolute path to shorten.
 * @returns Relative path string.
 */
function rel(path: string): string {
  return path
    .replace(ROOT + '/', '')
    .replace(ROOT + '\\', '')
    .replace(/\\/g, '/');
}

// ── Pure, exported detection functions ───────────────────────────────────────

/**
 * Recursively collects all .md and .rs files under dir,
 * excluding node_modules and dotfile directories.
 *
 * @param dir - Directory to search.
 * @returns Sorted list of absolute file paths.
 */
export function collectDocFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectDocFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.rs'))) {
      results.push(full);
    }
  }
  return results.sort();
}

/**
 * Returns true when the document declares itself a redirect stub.
 * Stubs are intentionally deprecated and are excluded from all health checks.
 *
 * @param content - Raw file content.
 * @returns Whether the content contains a redirect declaration.
 */
export function isRedirectStub(content: string): boolean {
  return /<!--\s*@deprecated\s+redirectTo:\s*.+-->/.test(content);
}

/**
 * Extracts backtick path references from doc content.
 * Code fence blocks (``` ... ```) and external URLs are excluded.
 * Only tokens containing a slash and a recognized code-file extension are returned.
 *
 * @param content - Raw file content.
 * @returns Array of {line, path} where line is 1-indexed.
 */
export function extractDocPaths(content: string): { line: number; path: string }[] {
  const results: { line: number; path: string }[] = [];
  const lines = content.split('\n');
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    // Toggle code fence on opening/closing ``` marker
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // Match all single-backtick-quoted tokens
    const matches = lines[i].matchAll(/`([^`\n]+)`/g);
    for (const m of matches) {
      const token = m[1].trim();
      if (/^https?:\/\//.test(token)) continue; // Skip URLs
      if (!token.includes('/')) continue; // Must look like a path
      if (!CODE_EXTENSIONS.test(token)) continue; // Must have a code file extension
      results.push({ line: i + 1, path: token });
    }
  }
  return results;
}

/**
 * Resolves a raw path token from a doc to an absolute filesystem path.
 * Strips the `rapitas-backend/` prefix when present, then joins with root.
 *
 * @param raw - Path token as extracted from the doc.
 * @param root - Absolute path to the project root (rapitas-backend/).
 * @returns Absolute path suitable for existsSync().
 */
export function resolveDocPath(raw: string, root: string): string {
  // NOTE: Docs may qualify paths with `rapitas-backend/` prefix but we resolve
  //       relative to root (= rapitas-backend/), so the prefix is redundant.
  const stripped = raw.startsWith('rapitas-backend/') ? raw.slice('rapitas-backend/'.length) : raw;
  return join(root, stripped);
}

/**
 * Finds backtick path references in a doc that don't resolve to existing files.
 * Returns an empty array for redirect stubs (those are intentionally deprecated).
 *
 * @param _docPath - Absolute path to the doc (unused — kept for call-site clarity).
 * @param content - Raw file content.
 * @param root - Absolute path to rapitas-backend/ for path resolution.
 * @returns Array of {line, path} for broken references.
 */
export function checkBrokenLinks(
  _docPath: string,
  content: string,
  root: string,
): { line: number; path: string }[] {
  if (isRedirectStub(content)) return [];
  const refs = extractDocPaths(content);
  return refs.filter(({ path }) => !existsSync(resolveDocPath(path, root)));
}

/**
 * Computes Jaccard similarity of two documents based on their non-empty trimmed lines.
 * Score ≥ JACCARD_THRESHOLD (0.7) indicates near-identical content.
 *
 * @param a - Content of document A.
 * @param b - Content of document B.
 * @returns Score between 0 and 1.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const toSet = (s: string): Set<string> =>
    new Set(
      s
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    );
  const setA = toSet(a);
  const setB = toSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const line of setA) {
    if (setB.has(line)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

/**
 * Detects duplicate docs pairs: at least one file has the auto-gen header AND
 * their Jaccard line-similarity is ≥ JACCARD_THRESHOLD.
 *
 * @param docFiles - Absolute paths of all doc files to compare.
 * @returns Pairs with their similarity score.
 */
export function detectDuplicates(docFiles: string[]): { a: string; b: string; score: number }[] {
  const pairs: { a: string; b: string; score: number }[] = [];
  const contents = docFiles.map((f) => read(f));

  for (let i = 0; i < docFiles.length; i++) {
    for (let j = i + 1; j < docFiles.length; j++) {
      // At least one file must carry the auto-gen marker
      if (!contents[i].includes(AUTO_GEN_MARKER) && !contents[j].includes(AUTO_GEN_MARKER)) {
        continue;
      }
      const score = jaccardSimilarity(contents[i], contents[j]);
      if (score >= JACCARD_THRESHOLD) {
        pairs.push({ a: docFiles[i], b: docFiles[j], score });
      }
    }
  }
  return pairs;
}

/**
 * Identifies orphaned docs: files with a broken-link rate > 50%.
 * Files with no backtick path references are excluded (not orphanable by this metric).
 * Redirect stubs are also excluded.
 *
 * @param docFiles - Absolute paths of all doc files.
 * @param root - Absolute path to rapitas-backend/ for path resolution.
 * @returns Absolute paths of orphan candidates.
 */
export function detectOrphans(docFiles: string[], root: string = ROOT): string[] {
  const orphans: string[] = [];
  for (const f of docFiles) {
    const content = read(f);
    if (isRedirectStub(content)) continue;
    const refs = extractDocPaths(content);
    if (refs.length === 0) continue;
    const broken = refs.filter(({ path }) => !existsSync(resolveDocPath(path, root)));
    if (broken.length / refs.length > 0.5) {
      orphans.push(f);
    }
  }
  return orphans;
}

// ── Phase helpers ─────────────────────────────────────────────────────────────

/**
 * Parses the --phase CLI argument.
 *
 * @param argv - process.argv array to scan.
 * @returns 1, 2, or 'all' when --phase is absent.
 * @throws {Error} For unrecognised --phase values (e.g. --phase=3).
 */
export function parsePhase(argv: string[]): 1 | 2 | 'all' {
  const flag = argv.find((a) => a.startsWith('--phase='));
  if (!flag) return 'all';
  const value = flag.slice('--phase='.length);
  if (value === '1') return 1;
  if (value === '2') return 2;
  throw new Error(`Unknown --phase value: "${value}". Valid values are 1 or 2.`);
}

/**
 * Runs Phase 1: broken-links (Domain 1) + orphans (Domain 3).
 * Domain 2 (duplicates / O(n²)) is not executed.
 *
 * NOTE: Path references are computed once per file and shared between
 *       broken-link and orphan detection, halving existsSync calls compared
 *       to calling checkBrokenLinks + detectOrphans independently.
 *
 * @param docFiles - Absolute paths of all doc files to scan.
 * @param root - Absolute path to rapitas-backend/ for path resolution.
 * @returns Broken-link violations (absolute file path) and orphan candidates.
 */
export function runPhase1(
  docFiles: string[],
  root: string,
): {
  brokenLinks: { file: string; line: number; path: string }[];
  orphans: string[];
} {
  const brokenLinks: { file: string; line: number; path: string }[] = [];
  const orphans: string[] = [];

  for (const docFile of docFiles) {
    const content = read(docFile);
    if (isRedirectStub(content)) continue;

    const refs = extractDocPaths(content);
    const broken = refs.filter(({ path }) => !existsSync(resolveDocPath(path, root)));

    for (const { line, path } of broken) {
      brokenLinks.push({ file: docFile, line, path });
    }

    if (refs.length > 0 && broken.length / refs.length > 0.5) {
      orphans.push(docFile);
    }
  }

  return { brokenLinks, orphans };
}

/**
 * Runs Phase 2: duplicate/double-managed docs (Domain 2).
 * Domain 1 (broken-links) and Domain 3 (orphans) are not executed.
 *
 * @param docFiles - Absolute paths of all doc files to compare.
 * @returns Duplicate pairs with Jaccard similarity scores.
 */
export function runPhase2(docFiles: string[]): {
  duplicates: { a: string; b: string; score: number }[];
} {
  return { duplicates: detectDuplicates(docFiles) };
}

// ── CLI execution (guarded so tests can import without side effects) ──────────

if (import.meta.main) {
  let phase: 1 | 2 | 'all';
  try {
    phase = parsePhase(process.argv);
  } catch (err) {
    process.stderr.write(`Error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  console.log('Checking docs/ health...\n');

  const docFiles = collectDocFiles(DOCS_DIR);
  console.log(`Found ${docFiles.length} doc file(s) in ${rel(DOCS_DIR)}/\n`);

  if (phase === 1) {
    // ── Phase 1: Domain 1 (Broken links) + Domain 3 (Orphans) ────────────────
    const { brokenLinks: brokenLinkViolations, orphans: orphanViolations } = runPhase1(
      docFiles,
      ROOT,
    );

    console.log(`Domain 1 (Broken links): ${brokenLinkViolations.length} violation(s)`);
    for (const v of brokenLinkViolations.slice(0, 30)) {
      const prefix = WARN_ONLY ? '  ⚠️ ' : '  ❌';
      console.log(`${prefix} ${rel(v.file)}:${v.line}  →  \`${v.path}\``);
    }
    if (brokenLinkViolations.length > 30) {
      console.log(`  ... and ${brokenLinkViolations.length - 30} more`);
    }

    console.log(
      `\nDomain 3 (Orphaned docs — broken-link rate >50%) [warn-only]: ${orphanViolations.length} candidate(s)`,
    );
    for (const f of orphanViolations) {
      console.log(`  ⚠️  ${rel(f)}`);
    }

    // NOTE: Orphans (Domain 3) are always warn-only; Phase 1 enforces broken-links only.
    const total = brokenLinkViolations.length;
    const exitCode = total === 0 || WARN_ONLY ? 0 : 1;
    const icon = total === 0 ? '✅' : WARN_ONLY ? '⚠️ ' : '❌';

    console.log(
      `\nResult: ${icon} ${total} total violation(s) in enforced domains (EXIT=${exitCode})`,
    );
    if (total > 0 && WARN_ONLY) {
      console.log('[warn-only mode] Violations detected but exiting 0.');
    } else if (total > 0 && !WARN_ONLY) {
      console.log('Fix broken links by updating references to moved/deleted files.');
    }

    process.exit(exitCode);
  } else if (phase === 2) {
    // ── Phase 2: Domain 2 (Duplicates) only ──────────────────────────────────
    const { duplicates: duplicateViolations } = runPhase2(docFiles);

    console.log(
      `Domain 2 (Duplicate/double-managed docs): ${duplicateViolations.length} violation(s)`,
    );
    for (const v of duplicateViolations) {
      const prefix = WARN_ONLY ? '  ⚠️ ' : '  ❌';
      console.log(`${prefix} ${rel(v.a)}  ↔  ${rel(v.b)}  (Jaccard=${v.score.toFixed(2)})`);
    }

    const total = duplicateViolations.length;
    const exitCode = total === 0 || WARN_ONLY ? 0 : 1;
    const icon = total === 0 ? '✅' : WARN_ONLY ? '⚠️ ' : '❌';

    console.log(
      `\nResult: ${icon} ${total} total violation(s) in enforced domains (EXIT=${exitCode})`,
    );
    if (total > 0 && WARN_ONLY) {
      console.log('[warn-only mode] Violations detected but exiting 0.');
    } else if (total > 0 && !WARN_ONLY) {
      console.log('Resolve duplicate docs by removing the hand-maintained copy.');
    }

    process.exit(exitCode);
  } else {
    // ── all: Domain 1 + 2 + 3 (original behaviour — backward compatible) ────

    // Domain 1: Broken links
    const brokenLinkViolations: { file: string; line: number; path: string }[] = [];
    for (const docFile of docFiles) {
      const content = read(docFile);
      const broken = checkBrokenLinks(docFile, content, ROOT);
      for (const { line, path } of broken) {
        brokenLinkViolations.push({ file: rel(docFile), line, path });
      }
    }

    // Domain 2: Duplicate / double-managed docs
    const duplicateViolations = detectDuplicates(docFiles);

    // Domain 3: Orphaned docs (always warn-only)
    const orphanViolations = detectOrphans(docFiles);

    // ── Report ──────────────────────────────────────────────────────────────

    console.log(`Domain 1 (Broken links): ${brokenLinkViolations.length} violation(s)`);
    for (const v of brokenLinkViolations.slice(0, 30)) {
      const prefix = WARN_ONLY ? '  ⚠️ ' : '  ❌';
      console.log(`${prefix} ${v.file}:${v.line}  →  \`${v.path}\``);
    }
    if (brokenLinkViolations.length > 30) {
      console.log(`  ... and ${brokenLinkViolations.length - 30} more`);
    }

    console.log(
      `\nDomain 2 (Duplicate/double-managed docs): ${duplicateViolations.length} violation(s)`,
    );
    for (const v of duplicateViolations) {
      const prefix = WARN_ONLY ? '  ⚠️ ' : '  ❌';
      console.log(`${prefix} ${rel(v.a)}  ↔  ${rel(v.b)}  (Jaccard=${v.score.toFixed(2)})`);
    }

    // Domain 3 is always warn-only regardless of --check mode
    console.log(
      `\nDomain 3 (Orphaned docs — broken-link rate >50%) [warn-only]: ${orphanViolations.length} candidate(s)`,
    );
    for (const f of orphanViolations) {
      console.log(`  ⚠️  ${rel(f)}`);
    }

    // ── Exit code ────────────────────────────────────────────────────────────

    const total = brokenLinkViolations.length + duplicateViolations.length;
    const exitCode = total === 0 || WARN_ONLY ? 0 : 1;
    const icon = total === 0 ? '✅' : WARN_ONLY ? '⚠️ ' : '❌';

    console.log(
      `\nResult: ${icon} ${total} total violation(s) in enforced domains (EXIT=${exitCode})`,
    );

    if (total > 0 && WARN_ONLY) {
      console.log('[warn-only mode] Violations detected but exiting 0.');
    } else if (total > 0 && !WARN_ONLY) {
      console.log(
        'Fix broken links by updating references to moved/deleted files,\n' +
          'and resolve duplicate docs by removing the hand-maintained copy.',
      );
    }

    process.exit(exitCode);
  }
}
