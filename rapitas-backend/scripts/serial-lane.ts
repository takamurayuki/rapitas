/**
 * serial-lane
 *
 * Decides which test files parallel-test.ts must run one-at-a-time in a
 * dedicated lane instead of the shared parallel pool.
 * It does not spawn or schedule anything itself.
 */

/**
 * Test files that spawn real `git` / `bun` / shell subprocesses (throwaway repos,
 * clones, child `bun` scripts). On Windows each spawn is an expensive process
 * creation, so several of these running at once starve every other test file of
 * CPU and trip Bun's 5s default timeout even in fully-mocked suites.
 */
export const SUBPROCESS_HEAVY_TEST_PATTERNS: readonly RegExp[] = [
  /[/\\]git-operations[/\\](core|worktree)[/\\][^/\\]+\.test\.ts$/,
  /[/\\]verification[/\\]automated-verifier\.diff-base-ref\.test\.ts$/,
  /[/\\]verification-job-runner\.test\.ts$/,
  /[/\\]schema-change-gate\.integration\.test\.ts$/,
  /[/\\]repo-bootstrap\.test\.ts$/,
  /[/\\]process-runner-args\.cmd-roundtrip\.test\.ts$/,
  /[/\\]scripts[/\\](check-ssot-drift|check-docs-health|setup-worktree)\.test\.ts$/,
];

/**
 * Parses RAPITAS_TEST_SERIAL_PATTERNS (comma-separated regexes) into RegExp objects.
 *
 * @param envValue - Raw RAPITAS_TEST_SERIAL_PATTERNS value / 環境変数の生の値
 * @returns Compiled extra patterns; empty entries are skipped / 追加パターン（空要素は無視）
 * @throws {SyntaxError} When an entry is not a valid regex / 正規表現として不正な要素がある場合
 */
export function parseSerialPatterns(envValue: string | undefined): RegExp[] {
  if (!envValue) return [];
  return envValue
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => new RegExp(s));
}

/**
 * Splits test files into the shared parallel pool and the one-at-a-time serial lane,
 * preserving the input order within each group.
 *
 * @param files - Absolute test file paths / テストファイルの絶対パス一覧
 * @param patterns - Patterns that route a file to the serial lane / 直列レーン対象のパターン
 * @returns `parallel` and `serial` file lists / 並列実行と直列実行に分けたファイル一覧
 */
export function partitionSerialFiles(
  files: readonly string[],
  patterns: readonly RegExp[],
): { parallel: string[]; serial: string[] } {
  const parallel: string[] = [];
  const serial: string[] = [];
  for (const file of files) {
    (patterns.some((p) => p.test(file)) ? serial : parallel).push(file);
  }
  return { parallel, serial };
}

/**
 * Computes how many parallel-pool workers to launch once one slot is reserved
 * for the serial lane, keeping total concurrency unchanged.
 *
 * @param concurrency - Total allowed concurrent subprocesses / 全体の同時実行上限
 * @param parallelCount - Files in the parallel pool / 並列プールのファイル数
 * @param serialCount - Files in the serial lane / 直列レーンのファイル数
 * @returns Worker count for the parallel pool (0 when it is empty) / 並列プールのワーカー数
 */
export function resolveParallelWorkerCount(
  concurrency: number,
  parallelCount: number,
  serialCount: number,
): number {
  if (parallelCount === 0) return 0;
  const reserved = serialCount > 0 ? 1 : 0;
  return Math.min(parallelCount, Math.max(1, concurrency - reserved));
}
