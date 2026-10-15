/**
 * Pareto Statistics
 *
 * Confidence-interval helpers for the frontier aggregation: Wilson score
 * interval for success rates and a normal-approximation interval for means.
 * Pure functions; no I/O.
 */

import type { IntervalEstimate } from './pareto-frontier-types';

/** z for a two-sided 95% interval. */
const Z_95 = 1.959964;

/**
 * Minimum executions before a point/baseline is treated as reliable. Mirrors
 * MIN_COMPARABLE_EXECUTIONS in cost-optimization-suggestions so both panels
 * agree on what "enough data" means.
 */
export const MIN_RELIABLE_SAMPLES = 5;

/** Sample count at which recommendation confidence saturates at 1. */
export const TARGET_SAMPLES = 20;

/**
 * Wilson score interval for a binomial proportion, expressed in percent.
 * Chosen over the Wald interval because segments are small (n of 5-30) and
 * proportions sit near 100%, where Wald collapses to a zero-width interval.
 *
 * @param successes - Number of successful trials / 成功数
 * @param n - Total trials / 試行数
 * @returns Proportion and 95% bounds in percent (all 0 when n = 0) / 百分率の推定値と区間
 */
export function wilsonInterval(successes: number, n: number): IntervalEstimate {
  if (n <= 0) return { value: 0, ciLow: 0, ciHigh: 0 };
  const p = successes / n;
  const z2 = Z_95 * Z_95;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const halfWidth = (Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return {
    value: round(p * 100, 2),
    ciLow: round(Math.max(0, center - halfWidth) * 100, 2),
    ciHigh: round(Math.min(1, center + halfWidth) * 100, 2),
  };
}

/**
 * Mean with a normal-approximation 95% interval (sample standard deviation).
 * With fewer than two values the interval collapses to the mean itself.
 *
 * @param values - Sample values / 標本値
 * @param digits - Rounding precision for the returned numbers / 丸め桁数
 * @returns Mean and 95% bounds (all 0 for an empty sample) / 平均と区間
 */
export function meanInterval(values: number[], digits = 2): IntervalEstimate {
  const n = values.length;
  if (n === 0) return { value: 0, ciLow: 0, ciHigh: 0 };
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const rounded = round(mean, digits);
  if (n < 2) return { value: rounded, ciLow: rounded, ciHigh: rounded };
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1);
  const halfWidth = (Z_95 * Math.sqrt(variance)) / Math.sqrt(n);
  return {
    value: rounded,
    ciLow: round(Math.max(0, mean - halfWidth), digits),
    ciHigh: round(mean + halfWidth, digits),
  };
}

/**
 * Confidence score for a recommendation backed by `sampleSize` executions.
 *
 * @param sampleSize - Executions behind the recommended point / 推奨点の標本数
 * @returns 0-1, saturating at TARGET_SAMPLES / 信頼度
 */
export function sampleConfidence(sampleSize: number): number {
  if (sampleSize < MIN_RELIABLE_SAMPLES) return 0;
  return round(Math.min(1, sampleSize / TARGET_SAMPLES), 2);
}

/**
 * Rounds to a fixed number of decimal digits.
 *
 * @param v - Value / 値
 * @param digits - Decimal digits / 小数桁数
 * @returns Rounded value / 丸めた値
 */
export function round(v: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(v * factor) / factor;
}
