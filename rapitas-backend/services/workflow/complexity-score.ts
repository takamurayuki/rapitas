/**
 * complexity-score
 *
 * The one place that decides which complexity a task "has" for routing: the
 * research-assessed score when one was read, otherwise a single safe default.
 * Shared by the workflow-mode selection (research-complexity.ts) and SmartRouter
 * (smart-model-router.ts). Not responsible for reading research.md.
 *
 * Why: the two consumers used to disagree on a missing/zero score — the mode
 * selection took a parsed 0 at face value (→ lightweight, no plan phase) while
 * SmartRouter's `complexityScore || 50` rewrote the same 0 to 50 (standard).
 */

/** Score used whenever no valid assessment exists (neutral, standard band). */
export const DEFAULT_COMPLEXITY_SCORE = 50;

/** A resolved complexity and whether it came from an actual assessment. */
export interface ResolvedComplexity {
  score: number;
  /** False when the safe default stood in for a missing/unreadable score. */
  assessed: boolean;
}

/**
 * Resolve a stored or parsed complexity to the score routing should use.
 *
 * An assessed 0 is a real score and is kept; only a missing, non-integer or
 * out-of-range value falls back to DEFAULT_COMPLEXITY_SCORE.
 *
 * @param raw - Parsed or stored score (null = not assessed) / 解析・保存済みのスコア
 * @returns The score to use and whether it was assessed / 使うスコアと評価済みか
 */
export function resolveComplexityScore(raw: number | null | undefined): ResolvedComplexity {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw <= 100) {
    return { score: raw, assessed: true };
  }
  return { score: DEFAULT_COMPLEXITY_SCORE, assessed: false };
}
