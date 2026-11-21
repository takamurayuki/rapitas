/**
 * coverage-test-files
 *
 * Decides which changed files count as tests for the coverage gate, in any
 * language a target project may use. Not responsible for choosing which tests
 * to run (related-tests.ts runs JS/TS tests only and keeps its own pattern).
 *
 * NOTE: The gate used the JS/TS runner's pattern, so a Go, Python or Rust
 * project could never satisfy it: trendline task 1512 added 235 lines to
 * internal/api/server_test.go and was still told no test changed (2026-11-21).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Test files by naming convention, one alternative per language. */
const TEST_NAME_RES: readonly RegExp[] = [
  /\.(test|spec)\.[cm]?[jt]sx?$/, // JS / TS
  /_test\.go$/, // Go
  /(^|\/)test_[^/]+\.py$|_test\.py$/, // Python (pytest)
  /(^|\/)tests\/[^/]+\.rs$/, // Rust integration tests
  /(^|\/)src\/test\/.+(Test|Tests|Spec)\.(java|kt)$/, // JVM
  /_spec\.rb$/, // Ruby (RSpec)
];

/** Files that don't need a paired test (declarations / config / stories). */
const COVERAGE_EXEMPT_RE = /(\.d\.ts$|\.config\.[cm]?[jt]s$|\.stories\.[jt]sx?$)/i;

/**
 * Whether a changed file is a test for the coverage gate.
 *
 * @param path - Repo-relative path / リポジトリ相対パス
 * @returns True for a test file in a recognised language / テストファイルなら true
 */
export function isCoverageTestFile(path: string): boolean {
  const p = path.replace(/\\/g, '/');
  return TEST_NAME_RES.some((re) => re.test(p));
}

/** Source-code extensions, any language; docs and config are not sources. */
const SOURCE_EXT_RE =
  /\.([cm]?[jt]sx?|go|py|rs|java|kt|kts|rb|cs|swift|php|scala|c|cc|cpp|h|hpp|ex|exs|dart|vue|svelte)$/i;

/**
 * The changed files the coverage gate should judge: existing source and test
 * files in any language.
 *
 * NOTE: The gate used to receive the lint list, which keeps JS/TS only, so in
 * a Go project neither the Go change nor its _test.go ever reached it. #1654
 * taught it the Go test name and trendline task 1512 was still blocked.
 *
 * @param workdir - Worktree root / worktree のルート
 * @param changedFiles - Every changed path, deletions included / 全変更パス（削除を含む）
 * @returns Paths that still exist and are source or tests / 存在するソース・テストのパス
 */
export function coverageCandidates(workdir: string, changedFiles: readonly string[]): string[] {
  return changedFiles.filter(
    (f) => SOURCE_EXT_RE.test(f) && existsSync(join(workdir, f)) && !isCoverageExempt(f),
  );
}

/**
 * Whether a changed source file needs no paired test.
 *
 * @param path - Repo-relative path / リポジトリ相対パス
 * @returns True for declarations, config and stories / 型宣言・設定・stories なら true
 */
export function isCoverageExempt(path: string): boolean {
  return COVERAGE_EXEMPT_RE.test(path);
}
