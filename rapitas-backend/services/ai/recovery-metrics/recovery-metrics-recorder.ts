/**
 * recovery-metrics-recorder
 *
 * The single write entry point for recovery attempt records. Never throws:
 * measurement is a side feature and a recording failure must not propagate
 * into the fallback path it observes (all automatic executions pass there).
 */
import { appendRecord } from './recovery-metrics-store';
import type { RecoveryAttemptInput, RecoveryAttemptRecord } from './recovery-metrics.types';
import { createLogger } from '../../../config/logger';

const log = createLogger('ai:recovery-metrics');

/**
 * Build a full record from the input and append it to the JSONL store.
 * Optional fields default (toProvider/costUsd/failureReason → null, latencyMs → 0).
 *
 * @param input - Attempt facts gathered at the fallback call site. / フォールバック地点で得た事実
 * @param nowMs - Record timestamp (injected — this module never calls Date.now()). / 記録時刻
 */
export function recordRecoveryAttempt(input: RecoveryAttemptInput, nowMs: number): void {
  // NOTE: Under bun test (NODE_ENV=test) without an explicit RAPITAS_DATA_DIR,
  // skip recording — existing regression suites drive the REAL fallback path,
  // and their attempts would pollute the developer's live metrics store.
  if (process.env.NODE_ENV === 'test' && !process.env.RAPITAS_DATA_DIR) return;
  try {
    const record: RecoveryAttemptRecord = {
      tsMs: nowMs,
      taskId: input.taskId,
      phase: input.phase,
      errorType: input.errorType,
      fromProvider: input.fromProvider,
      fromModel: input.fromModel,
      toProvider: input.toProvider ?? null,
      strategy: input.strategy,
      outcome: input.outcome,
      latencyMs: input.latencyMs ?? 0,
      costUsd: input.costUsd ?? null,
      failureReason: input.failureReason ?? null,
    };
    appendRecord(record);
  } catch (err) {
    log.warn({ err }, 'Failed to record recovery attempt (metrics only — execution unaffected)');
  }
}
