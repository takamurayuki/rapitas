/**
 * worker-health-baseline
 *
 * Pure statistics for the worker-health view: median, MAD, robust z-score
 * against same-weekday/same-hour samples, and the weighted composite score.
 * Not responsible for fetching data or detecting anomalies.
 */
import {
  MAD_TO_SIGMA,
  WORKER_HEALTH_CONFIG,
  WORKER_HEALTH_METRIC_KEYS,
  type WorkerHealthMetricKey,
} from './worker-health-config';

/**
 * Median of a non-empty list.
 *
 * @param values - Finite numbers / 有限数の配列
 * @returns The median, or NaN for an empty list / 中央値
 */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median absolute deviation around the median.
 *
 * @param values - Finite numbers / 有限数の配列
 * @returns MAD / 中央絶対偏差
 */
export function mad(values: number[]): number {
  const m = median(values);
  return median(values.map((v) => Math.abs(v - m)));
}

/**
 * Robust z-score of `value` against same-slot baseline samples.
 *
 * @param value - Current bucket value, null if unobserved / 現在値
 * @param samples - Same weekday+hour values of previous weeks (null = no data) / 同曜日同時刻の過去値
 * @param floor - Lower bound of sigma so MAD=0 cannot diverge / sigma の下限
 * @returns z-score, or null (pending) when value is null or fewer than 3 samples are valid
 */
export function robustZ(
  value: number | null,
  samples: Array<number | null>,
  floor: number,
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const valid = samples.filter((s): s is number => s !== null && Number.isFinite(s));
  if (valid.length < WORKER_HEALTH_CONFIG.minBaselineSamples) return null;
  const sigma = Math.max(MAD_TO_SIGMA * mad(valid), floor);
  return (value - median(valid)) / sigma;
}

/**
 * Weighted composite of the per-metric z-scores, deterioration direction only.
 * Completions below baseline is bad; every other metric above baseline is bad.
 *
 * @param z - z-score per metric (null = pending) / 指標別 z 値
 * @param weights - Weight per metric / 重み
 * @returns Composite score >= 0, or null if any metric is pending
 */
export function compositeScore(
  z: Record<WorkerHealthMetricKey, number | null>,
  weights: Record<WorkerHealthMetricKey, number>,
): number | null {
  let total = 0;
  for (const key of WORKER_HEALTH_METRIC_KEYS) {
    const v = z[key];
    if (v === null || !Number.isFinite(v)) return null;
    const bad = key === 'completions' ? -v : v;
    total += weights[key] * Math.min(Math.max(bad, 0), WORKER_HEALTH_CONFIG.zClip);
  }
  return total;
}
