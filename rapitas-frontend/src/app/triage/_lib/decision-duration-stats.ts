/**
 * decision-duration-stats
 *
 * Pure helpers for the per-kind decision duration estimate (window, validity, trimmed median).
 * Not responsible for persistence (see stores/decision-duration-store) or UI.
 */

/** Number of most recent durations kept per decision kind. */
export const DECISION_WINDOW_SIZE = 10;
/** Below this many samples no estimate is shown; a median of a few points is unstable. */
export const MIN_SAMPLES = 5;
/** Shorter than this is treated as an accidental start/finish double-press. */
export const MIN_VALID_MS = 3000;
/** Longer than this is treated as the user having walked away. */
export const MAX_VALID_MS = 1_800_000;
/** Fraction trimmed from each end; floor(n * ratio) so 5-9 samples are untouched. */
export const TRIM_RATIO = 0.1;

/**
 * Whether a measured duration is plausible enough to record.
 *
 * @param ms - Duration in milliseconds / 所要時間(ミリ秒)
 * @returns true when finite and within [MIN_VALID_MS, MAX_VALID_MS] / 範囲内ならtrue
 */
export function isValidDuration(ms: number): boolean {
  return Number.isFinite(ms) && ms >= MIN_VALID_MS && ms <= MAX_VALID_MS;
}

/**
 * Append a duration, keeping only the latest DECISION_WINDOW_SIZE entries.
 *
 * @param list - Existing durations, oldest first / 既存の記録
 * @param ms - New duration / 追加する所要時間
 * @returns New list; the input itself when ms is out of range / 新しい配列(範囲外は不変)
 */
export function appendDuration(list: readonly number[], ms: number): number[] {
  if (!isValidDuration(ms)) return [...list];
  return [...list, ms].slice(-DECISION_WINDOW_SIZE);
}

/**
 * Median after trimming floor(n * TRIM_RATIO) values from each end.
 *
 * @param list - Durations in ms / 所要時間の配列
 * @returns Trimmed median in ms, or null when fewer than MIN_SAMPLES / サンプル不足ならnull
 */
export function trimmedMedianMs(list: readonly number[]): number | null {
  const valid = list.filter(isValidDuration);
  if (valid.length < MIN_SAMPLES) return null;
  const sorted = [...valid].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * TRIM_RATIO);
  const kept = sorted.slice(cut, sorted.length - cut);
  const mid = Math.floor(kept.length / 2);
  return kept.length % 2 === 1 ? kept[mid] : (kept[mid - 1] + kept[mid]) / 2;
}

/**
 * Convert ms to display minutes, never below 1 so short decisions don't read "0 min".
 *
 * @param ms - Duration in ms / 所要時間(ミリ秒)
 * @returns Whole minutes, at least 1 / 分(最小1)
 */
export function toDisplayMinutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60000));
}
