/**
 * decision-ledger/aggregate
 *
 * Rollups over normalized decisions. Exists so accuracy is computed once, the
 * same way, everywhere — the four call sites that each rolled their own
 * aggregation are what let a 100%-discarded ledger look healthy for weeks.
 */

import type { Decision, DecisionVerdict, VerdictSummary } from './types';

/**
 * Count verdicts and derive the two ratios worth reading off them.
 *
 * `accuracy` deliberately excludes `indeterminate` and `pending`: a run of
 * outages would otherwise read as a collapse in decision quality. The share
 * that could not be judged is reported separately, because a ledger that cannot
 * judge most of its rows is the actual finding.
 *
 * @param decisions - Decisions to summarize. / 集計対象の決定
 * @returns Counts plus accuracy and the unjudgeable share. / 件数・正答率・判定不能率
 */
export function summarizeVerdicts(decisions: Decision[]): VerdictSummary {
  const count = (v: DecisionVerdict) => decisions.filter((d) => d.verdict === v).length;
  const correct = count('correct');
  const partial = count('partial');
  const wrong = count('wrong');
  const indeterminate = count('indeterminate');
  const pending = count('pending');
  const judged = correct + partial + wrong;

  return {
    total: decisions.length,
    correct,
    partial,
    wrong,
    indeterminate,
    pending,
    accuracy: judged > 0 ? correct / judged : null,
    indeterminateRate: decisions.length > 0 ? indeterminate / decisions.length : 0,
  };
}

/**
 * Group decisions by a derived key, preserving order within each group.
 *
 * @param decisions - Decisions to group. / 集計対象の決定
 * @param keyOf - Key to group by. / グループ化キー
 * @returns Map of key to its decisions. / キーごとの決定
 */
export function groupDecisions(
  decisions: Decision[],
  keyOf: (d: Decision) => string,
): Map<string, Decision[]> {
  const out = new Map<string, Decision[]>();
  for (const d of decisions) {
    const key = keyOf(d);
    const bucket = out.get(key);
    if (bucket) bucket.push(d);
    else out.set(key, [d]);
  }
  return out;
}

/**
 * Summarize each group in one pass.
 *
 * @param decisions - Decisions to group and summarize. / 集計対象の決定
 * @param keyOf - Key to group by. / グループ化キー
 * @returns Map of key to its verdict summary. / キーごとの判定集計
 */
export function summarizeBy(
  decisions: Decision[],
  keyOf: (d: Decision) => string,
): Map<string, VerdictSummary> {
  const out = new Map<string, VerdictSummary>();
  for (const [key, group] of groupDecisions(decisions, keyOf)) {
    out.set(key, summarizeVerdicts(group));
  }
  return out;
}

/**
 * Total attributable spend across decisions.
 *
 * @param decisions - Decisions to total. / 集計対象の決定
 * @returns Sum of costUsd. / 実支出の合計
 */
export function totalCostUsd(decisions: Decision[]): number {
  return decisions.reduce((sum, d) => sum + d.costUsd, 0);
}
