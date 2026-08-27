/**
 * probe-metrics-aggregator
 *
 * Pure window aggregation of probe attempt records into per-target metrics.
 * No I/O, no clock access — nowMs is injected so window boundaries are
 * deterministic under test (recovery-metrics-aggregator pattern).
 */
import type { ProbeAttemptRecord, ProbeMetric } from './probe-metrics.types';

/** Default trailing window (days) — matches recovery-metrics's window. */
export const DEFAULT_WINDOW_DAYS = 45;

/** Below this attempt count a group is flagged lowSample (data shown anyway). */
export const DEFAULT_MIN_SAMPLES = 8;

/** Window override via RAPITAS_PROBE_METRICS_WINDOW_DAYS (positive int). */
export function getProbeMetricsWindowDays(): number {
  const v = parseInt(process.env.RAPITAS_PROBE_METRICS_WINDOW_DAYS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_WINDOW_DAYS;
}

/** Min-sample override via RAPITAS_PROBE_METRICS_MIN_SAMPLES (positive int). */
export function getProbeMetricsMinSamples(): number {
  const v = parseInt(process.env.RAPITAS_PROBE_METRICS_MIN_SAMPLES ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_MIN_SAMPLES;
}

export interface AggregateOptions {
  /** Trailing window length in ms; records older than nowMs - windowMs are excluded. */
  windowMs: number;
  /** Groups with fewer attempts are flagged lowSample (still returned). */
  minSamples: number;
  /** Reference clock in epoch ms (injected for deterministic boundaries). */
  nowMs: number;
}

/**
 * Aggregate records into per-target metrics, sorted by attempts descending.
 * The window is inclusive at its lower boundary (tsMs >= nowMs - windowMs).
 *
 * @param records - Attempt records (any order). / 試行レコード
 * @param opts - Window, min-sample threshold and reference clock. / 集計条件
 * @returns Metrics per target; empty input yields an empty array. / ターゲット別集計
 */
export function aggregate(records: ProbeAttemptRecord[], opts: AggregateOptions): ProbeMetric[] {
  const cutoffMs = opts.nowMs - opts.windowMs;
  const groups = new Map<string, ProbeAttemptRecord[]>();
  for (const record of records) {
    if (record.tsMs < cutoffMs) continue;
    const group = groups.get(record.targetId);
    if (group) group.push(record);
    else groups.set(record.targetId, [record]);
  }

  const metrics: ProbeMetric[] = [];
  for (const group of groups.values()) {
    const attempts = group.length;
    let successes = 0;
    let transientRetries = 0;
    let permanentFailures = 0;
    let latencySum = 0;
    for (const record of group) {
      if (record.outcome === 'success') successes += 1;
      else if (record.outcome === 'transient_retry') transientRetries += 1;
      else permanentFailures += 1;
      latencySum += record.latencyMs;
    }
    metrics.push({
      targetId: group[0].targetId,
      attempts,
      successes,
      transientRetries,
      permanentFailures,
      successRate: attempts > 0 ? successes / attempts : 0,
      avgLatencyMs: attempts > 0 ? latencySum / attempts : 0,
      lowSample: attempts < opts.minSamples,
    });
  }

  metrics.sort((a, b) => b.attempts - a.attempts);
  return metrics;
}
