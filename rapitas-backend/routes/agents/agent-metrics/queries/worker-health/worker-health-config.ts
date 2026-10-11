/**
 * worker-health-config
 *
 * Single home for every tunable of the worker-health anomaly view: metric
 * weights, MAD floors, detection thresholds and window sizes. Not responsible
 * for computing anything — see worker-health-baseline.ts / -detector.ts.
 */

/** The four metrics that make up the composite score. */
export type WorkerHealthMetricKey = 'completions' | 'timeoutRate' | 'retryRate' | 'restarts';

export const WORKER_HEALTH_METRIC_KEYS: readonly WorkerHealthMetricKey[] = [
  'completions',
  'timeoutRate',
  'retryRate',
  'restarts',
];

/**
 * First phase scope: the worker as a whole, one unit. Restart counts are only
 * recorded per worker, so splitting by CLI/role would leave restarts unattributed.
 */
export const WORKER_HEALTH_UNITS = ['worker'] as const;

export const WORKER_HEALTH_CONFIG = {
  /** Equal weights until a measured false-positive rate justifies tuning (plan §複合スコアの重み). */
  weights: {
    completions: 0.25,
    timeoutRate: 0.25,
    retryRate: 0.25,
    restarts: 0.25,
  } as Record<WorkerHealthMetricKey, number>,
  /** Lower bound of sigma per metric; counts and ratios have different units. */
  floors: {
    completions: 1,
    timeoutRate: 0.05,
    retryRate: 0.05,
    restarts: 1,
  } as Record<WorkerHealthMetricKey, number>,
  /** Same weekday + hour, this many weeks back (acceptance criterion 1: 4 weeks). */
  baselineWeeks: 4,
  /** At least this many of the 4 baseline slots must hold data, else the point is pending. */
  minBaselineSamples: 3,
  /** Deterioration-direction z is clipped to [0, zClip] so one metric cannot dominate. */
  zClip: 5,
  /** Bucket width. */
  bucketMs: 3_600_000,
  /** Consecutive-run rule: composite >= runThreshold for runLength buckets. */
  runThreshold: 1.5,
  runLength: 3,
  /** Periodicity rule: lag-24h autocorrelation of the composite series. */
  acfLagBuckets: 24,
  acfWindowBuckets: 24 * 7,
  acfLowThreshold: 0.3,
  acfMinDrop: 0.4,
  /** How far back the API reports (hours); 14 days so the periodicity rule can compare two weeks. */
  displayHours: 24 * 14,
  /** Alert evaluation cadence. */
  evaluationIntervalMs: 15 * 60_000,
} as const;

/** MAD -> sigma consistency constant for normally distributed data. */
export const MAD_TO_SIGMA = 1.4826;

/**
 * Substrings (matched case-insensitively) of AgentExecution.errorMessage that
 * mark a timeout. The schema has no dedicated timeout status: status values in
 * use are completed / failed / cancelled / interrupted (plus transient
 * pending / running), so a timeout is a failed/interrupted run whose message says so.
 */
export const TIMEOUT_ERROR_KEYWORDS: readonly string[] = ['timeout', 'timed out', 'タイムアウト'];

/** AgentExecution.status values that count as a finished run for the timeout-rate denominator. */
export const FINISHED_EXECUTION_STATUSES: readonly string[] = [
  'completed',
  'failed',
  'interrupted',
];

/** WorkflowQueueItem.status values that count as finished for the retry-rate denominator. */
export const FINISHED_QUEUE_STATUSES: readonly string[] = ['completed', 'failed'];
