/**
 * recovery-metrics
 *
 * Barrel for the fallback recovery measurement layer (task 641): record,
 * persist and aggregate fallback attempt outcomes. Behavior-neutral — this
 * package never influences which fallback runs.
 */
export type {
  RecoveryErrorType,
  RecoveryStrategy,
  RecoveryOutcome,
  RecoveryAttemptRecord,
  RecoveryAttemptInput,
  RecoveryMetric,
} from './recovery-metrics.types';
export { recordRecoveryAttempt } from './recovery-metrics-recorder';
export { appendRecord, readRecords, attemptsFilePath } from './recovery-metrics-store';
export {
  aggregate,
  getRecoveryMetricsWindowDays,
  getRecoveryMetricsMinSamples,
  DEFAULT_WINDOW_DAYS,
  DEFAULT_MIN_SAMPLES,
  type AggregateOptions,
} from './recovery-metrics-aggregator';
