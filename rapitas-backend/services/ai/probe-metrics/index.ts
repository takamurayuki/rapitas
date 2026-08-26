/**
 * probe-metrics
 *
 * Barrel for the preflight probe measurement layer (task 673): record,
 * persist and aggregate probe attempt outcomes. Behavior-neutral — this
 * package never influences whether a probe passes or fails.
 */
export type { ProbeAttemptRecord, ProbeMetric } from './probe-metrics.types';
export { recordProbeAttempt } from './probe-metrics-recorder';
export { appendRecord, readRecords, attemptsFilePath } from './probe-metrics-store';
export {
  aggregate,
  getProbeMetricsWindowDays,
  getProbeMetricsMinSamples,
  DEFAULT_WINDOW_DAYS,
  DEFAULT_MIN_SAMPLES,
  type AggregateOptions,
} from './probe-metrics-aggregator';
