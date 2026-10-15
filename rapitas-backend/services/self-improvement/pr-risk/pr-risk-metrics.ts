/**
 * pr-risk-metrics
 *
 * Monthly precision/recall/FPR for PR-risk predictions and the periodic
 * threshold review rules (proposal, auto-adoption, auto-demotion), plus UTC
 * month helpers. Pure — persistence lives in pr-risk-review-job.
 */
import type { LabelledPrediction, PrRiskStage } from './pr-risk-types';

/** Below this many labelled PRs a proposal / demotion is statistically meaningless. */
export const MIN_REVIEW_SAMPLE = 20;
const MAX_FPR = 0.2;
const MIN_ADOPT_DELTA = 0.05;
const DEMOTE_PRECISION = 0.3;
const MONTH_SETTLE_MS = 72 * 3600 * 1000;

export interface MonthlyMetric {
  sample: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
  fpr: number | null;
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

function confusion(rows: LabelledPrediction[], thresholdOf: (r: LabelledPrediction) => number) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const r of rows) {
    const positive = r.score >= thresholdOf(r);
    if (r.label === 'failure') {
      if (positive) tp++;
      else fn++;
    } else if (positive) fp++;
    else tn++;
  }
  return { tp, fp, fn, tn };
}

/**
 * Confusion matrix + ratios, judged at the threshold in force when scored.
 *
 * @param rows - Labelled predictions for the month / 当月の確定ラベル付き予測
 * @returns Metric row; ratios are null when their denominator is 0 / 月次指標
 */
export function computeMonthlyMetric(rows: LabelledPrediction[]): MonthlyMetric {
  const { tp, fp, fn, tn } = confusion(rows, (r) => r.thresholdUsed);
  return {
    sample: rows.length,
    tp,
    fp,
    fn,
    tn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    fpr: ratio(fp, fp + tn),
  };
}

export interface ThresholdProposal {
  proposed: number | null;
  reason: 'insufficient_labels' | 'no_candidate_within_fpr' | 'max_f1_within_fpr';
}

/**
 * Propose a threshold: among 0.05..0.95 (step 0.05) keep FPR ≤ 0.2 and pick
 * the max F1; ties go to the higher threshold (fewer holds).
 *
 * @param rows - Labelled predictions (trailing 3 months) / 直近3か月の確定データ
 * @returns Proposal or null with a reason / 提案値と理由
 */
export function proposeThreshold(rows: LabelledPrediction[]): ThresholdProposal {
  const failures = rows.filter((r) => r.label === 'failure').length;
  if (rows.length < MIN_REVIEW_SAMPLE || failures === 0) {
    return { proposed: null, reason: 'insufficient_labels' };
  }
  let best: { t: number; f1: number } | null = null;
  for (let k = 1; k <= 19; k++) {
    const t = (k * 5) / 100; // integer arithmetic avoids 0.1+0.2-style drift
    const { tp, fp, fn, tn } = confusion(rows, () => t);
    const fpr = ratio(fp, fp + tn) ?? 0;
    if (fpr > MAX_FPR) continue;
    const f1 = tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
    if (f1 > 0 && (!best || f1 >= best.f1)) best = { t, f1 };
  }
  return best
    ? { proposed: best.t, reason: 'max_f1_within_fpr' }
    : { proposed: null, reason: 'no_candidate_within_fpr' };
}

/**
 * Whether a proposed threshold is adopted automatically (stage `auto` only).
 *
 * @param p - stage, modelVersion, proposed and current thresholds / 判定入力
 * @returns true when all adoption conditions hold / 自動採用するか
 */
export function shouldAdopt(p: {
  stage: PrRiskStage;
  modelVersion: number;
  proposed: number | null;
  current: number;
}): boolean {
  return (
    p.stage === 'auto' &&
    p.modelVersion > 0 &&
    p.proposed !== null &&
    // Rounded so 0.55 − 0.5 (=0.04999…) still counts as a 0.05 move.
    Math.round(Math.abs(p.proposed - p.current) * 1e9) / 1e9 >= MIN_ADOPT_DELTA
  );
}

/**
 * Whether `auto` must fall back to `hold` because precision collapsed.
 *
 * @param p - stage, sample, precision of the month / 判定入力
 * @returns true to demote / 降格するか
 */
export function shouldDemote(p: {
  stage: PrRiskStage;
  sample: number;
  precision: number | null;
}): boolean {
  return (
    p.stage === 'auto' &&
    p.sample >= MIN_REVIEW_SAMPLE &&
    p.precision !== null &&
    p.precision < DEMOTE_PRECISION
  );
}

/** UTC `YYYY-MM` of a date. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** UTC `YYYY-MM` of the month before `now`'s month. */
export function previousMonthKey(now: Date): string {
  return monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

/**
 * Half-open UTC bounds [start, end) of a month key.
 *
 * @param key - `YYYY-MM` / 月キー
 * @returns start and end dates / 月の開始と終了
 */
export function monthBounds(key: string): { start: Date; end: Date } {
  const [y, m] = key.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/**
 * The previous month becomes reviewable 72h into the current month, so PRs
 * merged on its last day have had their full rollback window.
 *
 * @param now - Current time / 現在時刻
 * @returns true when the previous month may be recorded / 前月を記録してよいか
 */
export function isMonthlyReviewDue(now: Date): boolean {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return now.getTime() >= start + MONTH_SETTLE_MS;
}
