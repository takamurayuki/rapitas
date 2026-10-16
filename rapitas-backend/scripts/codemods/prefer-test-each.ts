/**
 * codemod: prefer-test-each
 *
 * Transforms Pattern B test blocks — where a single it()/test() contains 3+
 * `expect(FN(ARG)).MATCHER(VAL)` statements with identical FN, MATCHER, and VAL
 * — into `test.each([...])('desc: %s', (input) => {...})` form.
 *
 * Blocks that cannot be safely transformed (mixed matchers, multi-arg calls,
 * async callbacks) are listed in manualReview without modification.
 *
 * Scope: all *.test.ts files under the backend root.
 * Safety: defaults to dry-run. Pass `--write` to apply changes on disk.
 *
 * Usage:
 *   bun run scripts/codemods/prefer-test-each.ts             # dry-run
 *   bun run scripts/codemods/prefer-test-each.ts -- --write  # apply
 */

import { join } from 'path';
import { runCodemod, type TransformInput, type TransformResult } from './lib/codemod-runner';

const BACKEND_ROOT = join(import.meta.dir, '..', '..');

/** Minimum number of repeated expect calls to trigger a transformation. */
const THRESHOLD = 3;

/**
 * Parsed representation of a single `expect(FN(ARG)).MATCHER(VAL);` statement.
 */
interface ExpectInfo {
  /** Leading whitespace of the original line. */
  indent: string;
  /** The function name called inside expect() — e.g. `isValidBranchName`. */
  fn: string;
  /** The single argument string (as source text) — e.g. `'invalid/branch'`. */
  arg: string;
  /** True when ARG contains a top-level comma, indicating multiple arguments. */
  isMultiArg: boolean;
  /** The matcher method name — e.g. `toBe`. */
  matcher: string;
  /** The expected value source text — e.g. `false`. */
  val: string;
}

/**
 * Returns true when the given string contains a top-level comma (i.e., at
 * bracket depth 0, outside string literals), which indicates multiple arguments.
 *
 * Handles: single-quoted strings, double-quoted strings, escaped characters.
 *
 * @param s - The string to inspect / 検査対象の文字列
 * @returns true if a top-level comma exists / トップレベルカンマがある場合 true
 */
function hasTopLevelComma(s: string): boolean {
  let depth = 0;
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === '\\') {
        i++; // skip escaped character
        continue;
      }
      if (ch === inStr) inStr = null;
    } else {
      if (ch === '"' || ch === "'") {
        inStr = ch;
      } else if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
      } else if (ch === ',' && depth === 0) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Parses a source line of the form `expect(FN(ARG)).MATCHER(VAL);`.
 * Returns null when the line is not an expect-form statement (e.g., a variable
 * declaration, an unrelated function call, etc.) — callers treat null as
 * "non-expect statement present in block" and skip the block.
 *
 * @param line - Source line to parse / パース対象のソース行
 * @returns Parsed expect info or null / パース結果またはnull
 */
function parseExpectLine(line: string): ExpectInfo | null {
  const trimmed = line.trimStart();
  const indent = line.slice(0, line.length - trimmed.length);

  if (!trimmed.startsWith('expect(')) return null;

  // Locate the matching ')' for the outer `expect(` using bracket depth tracking.
  let depth = 1;
  let pos = 'expect('.length;
  while (pos < trimmed.length && depth > 0) {
    const ch = trimmed[pos];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    pos++;
  }
  if (depth !== 0) return null;

  const expectArg = trimmed.slice('expect('.length, pos - 1);
  const afterExpect = trimmed.slice(pos);

  // afterExpect must be `.MATCHER(VAL);` — VAL must be a simple expression (no nested parens)
  const matcherMatch = afterExpect.match(/^\.(\w+)\(([^()]*)\)\s*;?\s*$/);
  if (!matcherMatch) return null;

  const matcher = matcherMatch[1];
  const val = matcherMatch[2].trim();

  // expectArg must begin with an identifier followed by `(`
  const fnEnd = expectArg.indexOf('(');
  if (fnEnd <= 0) return null;

  const fn = expectArg.slice(0, fnEnd);
  if (!/^\w+$/.test(fn)) return null; // FN must be a plain identifier

  // Find the matching ')' for the inner FN( call (tracks only parens, not braces)
  let innerDepth = 1;
  let innerPos = fnEnd + 1;
  while (innerPos < expectArg.length && innerDepth > 0) {
    const ch = expectArg[innerPos];
    if (ch === '(') innerDepth++;
    else if (ch === ')') innerDepth--;
    innerPos++;
  }
  if (innerDepth !== 0) return null;
  // Nothing should follow the closing ')' — if there is, the form is more complex
  if (innerPos !== expectArg.length) return null;

  const arg = expectArg.slice(fnEnd + 1, innerPos - 1);
  const isMultiArg = hasTopLevelComma(arg);

  return { indent, fn, arg, isMultiArg, matcher, val };
}

/** Regex matching the start of a transformable test/it block header line. */
const HEADER_RE =
  /^([ \t]*)(it|test)\s*\((['"])((?:[^'"\\]|\\.)*)\3\s*,\s*(async\s*)?\(\s*\)\s*=>\s*\{\s*$/;

/** Regex matching the closing `});` or `})` line of a test block. */
const BLOCK_END_RE = /^[ \t]*\}\s*\)\s*;?\s*$/;

/**
 * Generates the transformed test.each block lines.
 *
 * @param indent - Leading whitespace of the original test() line / テスト行の先頭空白
 * @param funcName - `it` or `test` / 関数名
 * @param title - Test description string / テストタイトル
 * @param expects - Parsed expect infos (all conditions verified) / パース済みexpect群
 * @returns Array of output lines / 出力行の配列
 */
function generateTestEach(
  indent: string,
  funcName: string,
  title: string,
  expects: ExpectInfo[],
): string[] {
  const bodyIndent = expects[0].indent;
  const { fn, matcher, val } = expects[0];
  const args = expects.map((e) => e.arg).join(', ');

  return [
    `${indent}${funcName}.each([${args}])(`,
    `${bodyIndent}'${title}: %s',`,
    `${bodyIndent}(input) => {`,
    `${bodyIndent}  expect(${fn}(input)).${matcher}(${val});`,
    `${bodyIndent}},`,
    `${indent});`,
  ];
}

/**
 * Transforms a single file: converts qualifying Pattern B test blocks to
 * test.each. Appends manualReview entries for blocks that satisfy the FN-count
 * threshold but cannot be safely auto-transformed (async, multi-arg, mixed
 * MATCHER/VAL). Idempotent — already-converted blocks are not re-processed.
 *
 * @param input - File path and content / ファイルパスと内容
 * @returns Transform result with changed flag and manualReview entries / 変換結果
 */
export function transformPreferTestEach(input: TransformInput): TransformResult {
  const { filePath, content } = input;
  const manualReview: string[] = [];

  const lines = content.split('\n');
  const resultLines: string[] = [];
  let changed = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Quick check: must start with `it(` or `test(`. Skip `it.each`, `test.skip`, etc.
    const quickMatch = line.match(/^([ \t]*)(it|test)\s*\(/);
    if (!quickMatch || /^[ \t]*(it|test)\.[a-zA-Z]/.test(line)) {
      resultLines.push(line);
      i++;
      continue;
    }

    // Full header parse: `[indent](it|test)('title', [async ]() => {`
    const headerMatch = line.match(HEADER_RE);
    if (!headerMatch) {
      // Multi-line header or complex form — push as-is
      resultLines.push(line);
      i++;
      continue;
    }

    const indent = headerMatch[1];
    const funcName = headerMatch[2];
    const title = headerMatch[4];
    const isAsync = !!headerMatch[5];

    // Collect body lines until the first `});` / `})` line
    const bodyLines: string[] = [];
    let j = i + 1;
    let foundEnd = false;

    while (j < lines.length) {
      if (BLOCK_END_RE.test(lines[j])) {
        foundEnd = true;
        break;
      }
      bodyLines.push(lines[j]);
      j++;
    }

    if (!foundEnd) {
      // Could not find block end — push as-is
      resultLines.push(line);
      i++;
      continue;
    }

    const lineNumber = i + 1; // 1-based for manualReview output

    // Parse all body lines as expect statements first — determine if this is Pattern B
    const expects: ExpectInfo[] = [];
    let allExpectForm = true;

    for (const bodyLine of bodyLines) {
      if (bodyLine.trim() === '') {
        // Blank lines inside block are treated as non-expect content
        allExpectForm = false;
        break;
      }
      const parsed = parseExpectLine(bodyLine);
      if (!parsed) {
        allExpectForm = false;
        break;
      }
      expects.push(parsed);
    }

    if (!allExpectForm || expects.length < THRESHOLD) {
      // Not all expect-form statements, or below threshold — push as-is silently
      resultLines.push(line);
      bodyLines.forEach((bl) => resultLines.push(bl));
      resultLines.push(lines[j]);
      i = j + 1;
      continue;
    }

    // From here, the block has Pattern B structure (≥THRESHOLD same-form expects).
    // Check conditions that block auto-transformation and require manual review.

    // Async blocks: await mixing would be lost in conversion
    if (isAsync) {
      manualReview.push(
        `${filePath}:${lineNumber} — async Pattern B block (${expects.length} expects): manual conversion to test.each required`,
      );
      resultLines.push(line);
      bodyLines.forEach((bl) => resultLines.push(bl));
      resultLines.push(lines[j]);
      i = j + 1;
      continue;
    }

    const firstFn = expects[0].fn;
    const firstMatcher = expects[0].matcher;
    const firstVal = expects[0].val;

    const allSameFn = expects.every((e) => e.fn === firstFn);
    const allSameMatcher = expects.every((e) => e.matcher === firstMatcher);
    const allSameVal = expects.every((e) => e.val === firstVal);
    const hasMultiArg = expects.some((e) => e.isMultiArg);

    // Multi-arg: detectable but cannot auto-transform safely
    if (hasMultiArg) {
      manualReview.push(
        `${filePath}:${lineNumber} — multi-arg FN call inside expect: manual conversion to test.each required`,
      );
      resultLines.push(line);
      bodyLines.forEach((bl) => resultLines.push(bl));
      resultLines.push(lines[j]);
      i = j + 1;
      continue;
    }

    // Mixed MATCHER or VAL: all expects are of the right form but differ in outcome
    if (!allSameFn || !allSameMatcher || !allSameVal) {
      manualReview.push(
        `${filePath}:${lineNumber} — mixed FN/MATCHER/VAL across ${expects.length} expects: manual conversion to test.each required`,
      );
      resultLines.push(line);
      bodyLines.forEach((bl) => resultLines.push(bl));
      resultLines.push(lines[j]);
      i = j + 1;
      continue;
    }

    // All conditions met — generate the test.each block
    const transformed = generateTestEach(indent, funcName, title, expects);
    transformed.forEach((tl) => resultLines.push(tl));
    changed = true;
    i = j + 1;
  }

  return {
    newContent: resultLines.join('\n'),
    changed,
    manualReview,
  };
}

if (import.meta.main) {
  const write = process.argv.includes('--write');
  runCodemod(transformPreferTestEach, {
    roots: [BACKEND_ROOT],
    extensions: ['.test.ts'],
    // NOTE: Override DEFAULT_EXCLUDE_DIRS — `tests` and `__tests__` must be scanned
    // since the codemod targets test files specifically.
    excludeDirs: ['node_modules', '.git', 'dist', '.next', 'generated', 'prisma', 'scripts'],
    label: 'codemod:test-each',
    write,
  });
}
