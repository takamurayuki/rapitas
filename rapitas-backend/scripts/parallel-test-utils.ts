/**
 * parallel-test-utils
 *
 * Pure helpers for parallel-test.ts: env knob parsing and progress-line formatting.
 * It does not read process.env or spawn anything; callers pass raw values in.
 */

/**
 * Parses RAPITAS_TEST_RETRY_COUNT into a non-negative integer retry count.
 * Returns 0 (disabled) for undefined, empty, non-numeric, negative, or Infinity input.
 *
 * @param envValue - Raw RAPITAS_TEST_RETRY_COUNT value / 環境変数の生の値
 * @returns Non-negative integer number of additional retry attempts (0 = no retry)
 */
export function parseRetryCount(envValue: string | undefined): number {
  if (envValue === undefined || envValue === '') return 0;
  const parsed = parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

/**
 * Resolves the max concurrent subprocess count from env or CPU count.
 *
 * @param envValue - Raw RAPITAS_TEST_CONCURRENCY value / 環境変数の生の値
 * @param cpuCount - Number of logical CPU cores / 論理CPUコア数
 * @returns Positive integer concurrency limit (minimum 1)
 */
export function resolveConcurrency(envValue: string | undefined, cpuCount: number): number {
  if (envValue !== undefined && envValue !== '') {
    const parsed = parseInt(envValue, 10);
    // NOTE: Infinity parses as a finite value check fails, so it correctly falls back to 1.
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return 1;
  }
  return Math.max(1, cpuCount - 1);
}

/**
 * Formats a one-line progress entry for a completed test file.
 *
 * @param index - 1-based completion count / 完了順の1始まり番号
 * @param total - Total test file count / テストファイルの総数
 * @param passed - true if exit code was 0 / 合格判定
 * @param relPath - Relative path from backend root / バックエンドルートからの相対パス
 * @param elapsedMs - Elapsed wall-clock time / 経過時間（ミリ秒）
 * @returns Formatted "[i/N] PASS|FAIL <relPath> (Xms)" string
 */
export function formatProgressLine(
  index: number,
  total: number,
  passed: boolean,
  relPath: string,
  elapsedMs: number,
): string {
  return `[${index}/${total}] ${passed ? 'PASS' : 'FAIL'} ${relPath} (${elapsedMs.toFixed(0)}ms)`;
}
