/**
 * check-boundary-tests
 *
 * Detects drift between resolver source files and their adjacent test files.
 * For each `*-resolver.ts` file, it checks that:
 *   1. A corresponding `*-resolver.test.ts` file exists.
 *   2. Each exported `resolve*` function name appears in the test file body
 *      (after stripping comments, to avoid false positives from commented-out code).
 *
 * Designed to be used as an incremental CI check — pass only changed resolver
 * files via `--files` to avoid re-scanning the entire codebase on every PR.
 *
 * Usage:
 *   bun scripts/check-boundary-tests.ts                           # full scan, warn-only
 *   bun scripts/check-boundary-tests.ts --check                   # exit 1 on drift
 *   bun scripts/check-boundary-tests.ts --warn-only               # explicit warn-only (same as default)
 *   bun scripts/check-boundary-tests.ts --files=a.ts,b.ts         # scan only listed files
 *   bun scripts/check-boundary-tests.ts --check --files=a.ts,b.ts # check drift in listed files only
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { dirname, basename, extname, resolve, join } from 'path';
import { fileURLToPath } from 'url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPTS_DIR, '..');

/** Root directories scanned when --files is absent. */
const SCAN_ROOTS = [join(ROOT, 'services')];

/** Directory names excluded from the recursive walk. */
const EXCLUDE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '__tests__',
  '.next',
  'generated',
  'prisma',
  'tests',
  'scripts',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single resolver×test coverage finding. */
export interface DriftEntry {
  /** Source resolver file path (relative to ROOT). */
  resolverFile: string;
  /** 'missing-test' when no .test.ts was found; 'uncovered' when a function is absent from the test. */
  kind: 'missing-test' | 'uncovered';
  /** Function name, only present for 'uncovered' entries. */
  fnName?: string;
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

/**
 * Recursively collects `.ts` files under `dir`, skipping excluded directories.
 *
 * @param dir - Directory to walk / 走査するディレクトリ
 * @param results - Accumulator array (mutated in-place) / 結果の蓄積配列
 * @returns Flat list of absolute `.ts` file paths
 */
function walkTs(dir: string, results: string[] = []): string[] {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) {
        walkTs(join(dir, entry.name), results);
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(join(dir, entry.name));
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// CLI argument helpers (mirrors gen-type-guards.ts parseFilesArg)
// ---------------------------------------------------------------------------

/**
 * Parses the `--files` CLI argument into an array of file paths.
 *
 * Forms:
 *   --files=foo.ts,bar.ts  → ['foo.ts', 'bar.ts']
 *   --files foo.ts bar.ts  → ['foo.ts', 'bar.ts'] (stops at next flag)
 *   (absent)               → null (full SCAN_ROOTS walk)
 *
 * @param argv - process.argv / コマンドライン引数配列
 * @returns Parsed paths, or null when --files is absent
 */
export function parseFilesArg(argv: string[]): string[] | null {
  const idx = argv.findIndex((a) => a === '--files' || a.startsWith('--files='));
  if (idx === -1) return null;

  const arg = argv[idx];
  if (arg.startsWith('--files=')) {
    const val = arg.slice('--files='.length);
    return val
      ? val
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean)
      : [];
  }

  // Space-separated: consume non-flag args after --files
  const files: string[] = [];
  for (let i = idx + 1; i < argv.length; i++) {
    if (argv[i].startsWith('-')) break;
    files.push(argv[i]);
  }
  return files;
}

// ---------------------------------------------------------------------------
// Resolver function extraction
// ---------------------------------------------------------------------------

/**
 * Extracts exported `resolve*` function names from a TypeScript source file.
 * Matches both `export (async) function resolveXxx` and `export const resolveXxx =`.
 *
 * @param content - File content / ファイル内容
 * @returns Array of extracted function names / 抽出した関数名の配列
 */
export function extractResolverFunctions(content: string): string[] {
  const names = new Set<string>();

  // export async function resolveXxx / export function resolveXxx
  for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+(resolve\w+)/g)) {
    names.add(m[1]);
  }

  // export const resolveXxx =
  for (const m of content.matchAll(/export\s+const\s+(resolve\w+)\s*=/g)) {
    names.add(m[1]);
  }

  return [...names];
}

// ---------------------------------------------------------------------------
// Comment stripping (to avoid false positives from commented-out names)
// ---------------------------------------------------------------------------

/**
 * Removes line comments (`// …`) and block comments (`/* … *​/`) from TypeScript source.
 * Operates on plain text — does not handle comments inside string literals.
 *
 * @param content - Raw source text / 生ソーステキスト
 * @returns Source with comment text replaced by spaces / コメントを除去したソース
 */
export function stripComments(content: string): string {
  // Remove block comments (non-greedy, dotAll)
  let out = content.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));
  // Remove line comments
  out = out.replace(/\/\/[^\n]*/g, '');
  return out;
}

// ---------------------------------------------------------------------------
// Resolver scanning
// ---------------------------------------------------------------------------

/**
 * Returns the list of resolver `.ts` files to check.
 * When `files` is non-null, scans only those files (after filtering non-resolver paths).
 * When null, recursively walks SCAN_ROOTS for `*-resolver.ts` files.
 *
 * @param files - Explicit file list, or null for full scan / 明示ファイルリスト
 * @returns Absolute paths to resolver source files / リゾルバーソースファイルの絶対パス
 */
export function collectResolverFiles(files: string[] | null): string[] {
  if (files !== null && files.length > 0) {
    return files
      .map((f) => (f.startsWith('/') || /^[A-Za-z]:/.test(f) ? f : resolve(ROOT, f)))
      .filter(
        (f) =>
          f.endsWith('.ts') &&
          !f.endsWith('.test.ts') &&
          !f.endsWith('.generated.ts') &&
          basename(f).endsWith('-resolver.ts'),
      );
  }

  // Full scan
  const all: string[] = [];
  for (const root of SCAN_ROOTS) {
    walkTs(root, all);
  }
  return all.filter(
    (f) =>
      basename(f).endsWith('-resolver.ts') &&
      !f.endsWith('.test.ts') &&
      !f.endsWith('.generated.ts'),
  );
}

// ---------------------------------------------------------------------------
// Drift detection
// ---------------------------------------------------------------------------

/**
 * Checks a single resolver file for coverage drift.
 * Returns one entry per missing test file or uncovered function.
 *
 * @param resolverPath - Absolute path to the resolver source / リゾルバーソースの絶対パス
 * @returns Array of drift entries (empty = no drift) / ドリフトエントリの配列
 */
export function checkResolverDrift(resolverPath: string): DriftEntry[] {
  const rel = resolverPath.replace(ROOT + '/', '').replace(ROOT + '\\', '');
  const entries: DriftEntry[] = [];

  let content: string;
  try {
    content = readFileSync(resolverPath, 'utf-8');
  } catch {
    // Silent skip for unreadable files (e.g., non-existent path in --files list)
    return [];
  }

  const fnNames = extractResolverFunctions(content);
  if (fnNames.length === 0) {
    // No resolve* exports — not a resolver we need to check
    return [];
  }

  // Derive expected test file path (same dir, same base, + .test.ts)
  const dir = dirname(resolverPath);
  const base = basename(resolverPath, extname(resolverPath));
  const testPath = join(dir, `${base}.test.ts`);

  if (!existsSync(testPath)) {
    entries.push({ resolverFile: rel, kind: 'missing-test' });
    return entries;
  }

  let testContent: string;
  try {
    testContent = readFileSync(testPath, 'utf-8');
  } catch {
    entries.push({ resolverFile: rel, kind: 'missing-test' });
    return entries;
  }

  // Strip comments before searching to avoid false positives from commented-out names
  const strippedTestContent = stripComments(testContent);

  for (const fn of fnNames) {
    if (!strippedTestContent.includes(fn)) {
      entries.push({ resolverFile: rel, kind: 'uncovered', fnName: fn });
    }
  }

  return entries;
}

/**
 * Runs the full drift check across a set of resolver files.
 *
 * @param files - Explicit file list, or null for full SCAN_ROOTS walk / 明示ファイルリスト
 * @returns All drift entries found / 検出したドリフトエントリ全件
 */
export function checkBoundaryTests(files: string[] | null): DriftEntry[] {
  const resolvers = collectResolverFiles(files);
  const allDrift: DriftEntry[] = [];
  for (const r of resolvers) {
    allDrift.push(...checkResolverDrift(r));
  }
  return allDrift;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const CHECK_MODE = process.argv.includes('--check');
  const WARN_ONLY = process.argv.includes('--warn-only') || !CHECK_MODE;
  const filesArg = parseFilesArg(process.argv);

  const drifts = checkBoundaryTests(filesArg);

  if (drifts.length === 0) {
    console.log('check-boundary-tests: no drift detected.');
    process.exit(0);
  }

  for (const d of drifts) {
    if (d.kind === 'missing-test') {
      console.error(`DRIFT [missing-test]: ${d.resolverFile} — no adjacent .test.ts found`);
    } else {
      console.error(`DRIFT [uncovered]: ${d.resolverFile} — ${d.fnName}`);
    }
  }

  if (!WARN_ONLY) {
    console.error(
      `\n${drifts.length} drift(s) detected. Add test coverage for the functions listed above.`,
    );
    process.exit(1);
  }

  // warn-only: report but exit 0
  console.warn(
    `\n[warn-only] ${drifts.length} drift(s) detected. Add test coverage to clear these warnings.`,
  );
  process.exit(0);
}
