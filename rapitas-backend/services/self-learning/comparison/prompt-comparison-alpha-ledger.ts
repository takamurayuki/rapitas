/**
 * PromptComparisonAlphaLedger
 *
 * Pure alpha-spending budget calculations for repeated significance testing:
 * a telescoping series allocates a shrinking slice of a fixed total alpha to
 * each candidate (by arrival order k) and, within a candidate, to each
 * re-evaluation look (by look order j). No I/O, no clock — persistence lives
 * in prompt-comparison-alpha-storage.ts, mirroring the metrics/store split.
 */

/** Family-wise total alpha budget shared across all candidates ever evaluated. */
export const TOTAL_ALPHA = 0.05;

/** One recorded alpha-spending decision for a single (candidate, look) pair. */
export interface AlphaDecision {
  k: number;
  j: number;
  alpha: number;
  pValue: number;
  significant: boolean;
}

/**
 * Alpha budget allocated to the k-th candidate ever evaluated. The series
 * TOTAL_ALPHA/(k(k+1)) for k=1,2,3,... telescopes to TOTAL_ALPHA, so the
 * family-wise budget across an unbounded number of candidates never exceeds
 * TOTAL_ALPHA.
 *
 * @param k - 1-based arrival order of the candidate. / 候補の登場順（1始まり）
 * @returns Alpha budget for this candidate. / この候補に割り当てるα
 * @throws {RangeError} When k is not a positive integer. / kが正の整数でない場合
 */
export function alphaForCandidate(k: number): number {
  if (!Number.isInteger(k) || k < 1) {
    throw new RangeError(`alphaForCandidate: k must be a positive integer, got ${k}`);
  }
  return TOTAL_ALPHA / (k * (k + 1));
}

/**
 * Alpha budget allocated to the j-th look (re-evaluation) of a candidate
 * whose own budget is alphaK. The series alphaK/(j(j+1)) for j=1,2,3,...
 * telescopes to alphaK, so repeatedly re-judging the same candidate never
 * spends more than its own budget.
 *
 * @param alphaK - Candidate's own alpha budget (from alphaForCandidate). / 候補の予算
 * @param j - 1-based look order within the candidate. / 評価回数（1始まり）
 * @returns Alpha budget for this look. / この評価回に割り当てるα
 * @throws {RangeError} When j is not a positive integer. / jが正の整数でない場合
 */
export function alphaForLook(alphaK: number, j: number): number {
  if (!Number.isInteger(j) || j < 1) {
    throw new RangeError(`alphaForLook: j must be a positive integer, got ${j}`);
  }
  return alphaK / (j * (j + 1));
}

/**
 * Decide significance for one (candidate, look) pair under the alpha-spending
 * schedule.
 *
 * @param k - 1-based arrival order of the candidate. / 候補の登場順
 * @param j - 1-based look order within the candidate. / 評価回数
 * @param pValue - One-sided Fisher exact p-value for this look. / この評価のp値
 * @returns The alpha-spending decision. / α-spending判定
 */
export function decideWithAlphaSpending(k: number, j: number, pValue: number): AlphaDecision {
  const alpha = alphaForLook(alphaForCandidate(k), j);
  return { k, j, alpha, pValue, significant: pValue < alpha };
}
