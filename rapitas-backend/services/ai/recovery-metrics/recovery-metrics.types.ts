/**
 * recovery-metrics.types
 *
 * Type definitions for the fallback recovery measurement layer (task 641):
 * one JSONL record per fallback attempt plus the aggregated per-(errorType ×
 * strategy) metric shape served by GET /agents/recovery-metrics.
 * Not responsible for any recovery behavior — measurement only.
 */
import type { CooldownReason } from '../provider-cooldown';

/** Classifier verdict for the failed run; `unclassified` = no rule matched. */
export type RecoveryErrorType = CooldownReason | 'unclassified';

/**
 * Recovery strategy applied to the failure.
 * `model-strip` = model_unavailable's "same provider, drop --model" retry,
 * `none` = no fallback candidate was available.
 */
export type RecoveryStrategy = 'reroute' | 'model-strip' | 'none';

/** Result of the fallback attempt (`no_candidate` = nothing was retried). */
export type RecoveryOutcome = 'success' | 'failure' | 'no_candidate';

/** One JSONL line in `${RAPITAS_DATA_DIR}/recovery-metrics/attempts.jsonl`. */
export interface RecoveryAttemptRecord {
  /** Epoch ms at record time (injected by the caller, never Date.now() here). */
  tsMs: number;
  taskId: number;
  /** Workflow role (researcher/planner/…) or `manual` for the executor path. */
  phase: string;
  errorType: RecoveryErrorType;
  /** Provider implicated in the original failure. */
  fromProvider: string;
  fromModel: string | null;
  /** Provider retried on; null when no candidate was available. */
  toProvider: string | null;
  strategy: RecoveryStrategy;
  outcome: RecoveryOutcome;
  /** Duration of the fallback run in ms (0 when nothing was retried). */
  latencyMs: number;
  /** Real cost (USD) of the fallback run; null when not reported. */
  costUsd: number | null;
  /** Strict re-classification of the fallback failure; null on success. */
  failureReason: string | null;
}

/** Recorder input — tsMs is injected, tail fields default when omitted. */
export type RecoveryAttemptInput = Omit<
  RecoveryAttemptRecord,
  'tsMs' | 'toProvider' | 'latencyMs' | 'costUsd' | 'failureReason'
> &
  Partial<Pick<RecoveryAttemptRecord, 'toProvider' | 'latencyMs' | 'costUsd' | 'failureReason'>>;

/** Aggregated stats for one (errorType × strategy) group within the window. */
export interface RecoveryMetric {
  errorType: RecoveryErrorType;
  strategy: RecoveryStrategy;
  attempts: number;
  successes: number;
  failures: number;
  noCandidates: number;
  /** successes / attempts (0 when attempts is 0 — never NaN). */
  successRate: number;
  avgLatencyMs: number;
  /** Null-cost records are excluded from the mean; all-null yields null. */
  avgCostUsd: number | null;
  /** failureReason → count distribution over failed attempts. */
  failureReasons: Record<string, number>;
  /** attempts < minSamples — UI renders a "サンプル不足" hint. */
  lowSample: boolean;
}
