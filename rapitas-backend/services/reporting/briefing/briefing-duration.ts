/**
 * briefing-duration
 *
 * Deterministic playback-time estimation for the briefing. Real audio length
 * is not measured: the estimate (characters / speech rate) is the contract.
 */

/** Hard cap of the briefing (acceptance criterion 2). */
export const BRIEFING_MAX_SECONDS = 180;

/** Japanese narration speed approximation. */
export const BRIEFING_CHARS_PER_SECOND = 5;

/** Character budget derived from the two constants above (900). */
export const BRIEFING_MAX_CHARS = BRIEFING_MAX_SECONDS * BRIEFING_CHARS_PER_SECOND;

/**
 * Estimate playback seconds of a text.
 *
 * @param text - Spoken text / 読み上げ本文
 * @returns Estimated seconds, rounded up / 推定秒数
 */
export function estimateSeconds(text: string): number {
  return Math.ceil([...text].length / BRIEFING_CHARS_PER_SECOND);
}

/**
 * Clip a string to a maximum number of characters, adding an ellipsis.
 *
 * @param text - Source text / 元の文字列
 * @param max - Maximum characters including the ellipsis / 最大文字数
 */
export function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}
