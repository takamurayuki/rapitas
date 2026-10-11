/**
 * worker-health-detector
 *
 * Pure deviation detectors over the composite-score series: a consecutive-run
 * rule and a lag-24h autocorrelation collapse rule. Not responsible for
 * notifying or de-duplicating — see worker-health-alert-service.ts.
 */
import { WORKER_HEALTH_CONFIG } from './worker-health-config';

export interface RunDetection {
  fired: boolean;
  /** Index of the last point of the (latest) qualifying run; -1 if none. */
  endIndex: number;
}

/**
 * Detect `n` or more consecutive points at or above `threshold`.
 *
 * @param series - Composite scores; null (pending) breaks a run / 複合スコア系列
 * @param threshold - Inclusive threshold / しきい値
 * @param n - Required run length / 必要な連続点数
 * @returns Whether a run exists and where the latest one ends
 */
export function detectRun(
  series: Array<number | null>,
  threshold: number,
  n: number,
): RunDetection {
  let run = 0;
  let endIndex = -1;
  for (let i = 0; i < series.length; i++) {
    const v = series[i];
    if (v !== null && v >= threshold) {
      run++;
      if (run >= n) endIndex = i;
    } else {
      run = 0;
    }
  }
  return { fired: endIndex >= 0, endIndex };
}

/**
 * Lag-k autocorrelation over pairs where both points are present.
 *
 * @param series - Series, nulls allowed / 系列
 * @param lag - Lag in points / ラグ
 * @returns Correlation in [-1, 1], or null when under half of the pairs are
 *   usable or the series is constant
 */
export function autocorrelation(series: Array<number | null>, lag: number): number | null {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i + lag < series.length; i++) {
    const a = series[i];
    const b = series[i + lag];
    if (a !== null && b !== null) pairs.push([a, b]);
  }
  const possible = series.length - lag;
  if (possible <= 0 || pairs.length < possible / 2 || pairs.length < 2) return null;
  const meanA = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const meanB = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (const [a, b] of pairs) {
    num += (a - meanA) * (b - meanB);
    da += (a - meanA) ** 2;
    db += (b - meanB) ** 2;
  }
  const denom = Math.sqrt(da * db);
  return denom === 0 ? null : num / denom;
}

export interface PeriodicityDetection {
  fired: boolean;
  recent: number | null;
  previous: number | null;
}

/**
 * Detect a collapse of the daily rhythm: lag-24 autocorrelation of the last
 * 7 days is low AND dropped by at least `acfMinDrop` versus the 7 days before.
 *
 * @param series - Hourly composite scores, oldest first / 時間別の複合スコア
 * @returns Detection and both autocorrelation values; never fires without 14 days of data
 */
export function detectPeriodicityCollapse(series: Array<number | null>): PeriodicityDetection {
  const { acfLagBuckets, acfWindowBuckets, acfLowThreshold, acfMinDrop } = WORKER_HEALTH_CONFIG;
  if (series.length < acfWindowBuckets * 2) {
    return { fired: false, recent: null, previous: null };
  }
  const recentWin = series.slice(series.length - acfWindowBuckets);
  const prevWin = series.slice(
    series.length - 2 * acfWindowBuckets,
    series.length - acfWindowBuckets,
  );
  const recent = autocorrelation(recentWin, acfLagBuckets);
  const previous = autocorrelation(prevWin, acfLagBuckets);
  const fired =
    recent !== null &&
    previous !== null &&
    recent < acfLowThreshold &&
    previous - recent >= acfMinDrop;
  return { fired, recent, previous };
}
