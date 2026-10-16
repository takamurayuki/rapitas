/**
 * failure-tail
 *
 * Bounds and normalizes the failing-test log tail stored on a RunRecord.
 * Not responsible for persistence — run-history-store only serializes what it is given.
 */

/** Max lines kept per failing test file; keeps run-history.json small. */
export const MAX_FAILURE_TAIL_LINES = 40;

/** Max characters kept per line; guards against minified output or huge stack dumps. */
export const MAX_FAILURE_TAIL_LINE_CHARS = 500;

/**
 * Extracts the bounded tail of a test run's combined output.
 *
 * @param text - Raw stdout/stderr text / 標準出力・標準エラーの生テキスト
 * @returns Last non-empty lines, each length-capped; empty when nothing was printed / 末尾の行配列
 */
export function extractFailureTail(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => l.slice(0, MAX_FAILURE_TAIL_LINE_CHARS));
  return lines.slice(-MAX_FAILURE_TAIL_LINES);
}

/**
 * Validates untrusted input (manual-run API body) into a bounded tail.
 *
 * @param raw - Candidate value / 検証対象の値
 * @returns Clamped string array, or undefined when absent, empty or malformed / 正規化済み配列
 */
export function normalizeFailureTail(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || !raw.every((l) => typeof l === 'string')) return undefined;
  const tail = extractFailureTail((raw as string[]).join('\n'));
  return tail.length > 0 ? tail : undefined;
}
