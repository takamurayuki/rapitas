/**
 * decision-ledger/settle
 *
 * The one place a task's decisions are settled. Called from the existing task
 * outcome path — deliberately not a new scheduler: with several settlement
 * points, a disagreement between them leaves no way to tell which verdict was
 * the real one.
 */

import { createLogger } from '../../config/logger';

const log = createLogger('decision-ledger:settle');

/** What one settlement pass resolved. */
export interface SettlementResult {
  /** Decisions examined for this task. */
  checked: number;
  /** Decisions that moved off `pending`. */
  settled: number;
}

/**
 * Settle every still-pending decision belonging to a task.
 *
 * Decisions whose execution has not reached a terminal state stay pending —
 * typically the phase that triggered the outcome itself, which the periodic
 * sweep picks up. The sweep runs the same judging code, so prompt settlement
 * and swept settlement cannot produce different verdicts.
 *
 * Best-effort: a task's outcome must never fail because its ledger could not be
 * settled.
 *
 * @param taskId - Task that just reached a terminal state. / 終端に達したタスクID
 * @returns Counts examined and settled. / 検査件数と確定件数
 */
export async function settleDecisions(taskId: number): Promise<SettlementResult> {
  if (!Number.isFinite(taskId)) return { checked: 0, settled: 0 };
  try {
    const { runConsistencyCheckBatch } = await import('../observability/decision-trace');
    const { settleFilingDecisions } = await import('./settle-filing');
    // Execution-backed decisions and filings settle from different evidence, so
    // each is judged by the code that owns that evidence — both here, so a task
    // still has exactly one settlement point.
    const [execution, filings] = await Promise.all([
      runConsistencyCheckBatch({ taskId }),
      settleFilingDecisions(taskId),
    ]);
    const checked = execution.checked + filings.checked;
    const settled = execution.updated + filings.settled;
    if (checked > 0) {
      log.info({ taskId, checked, settled }, '[decision-ledger] settled task decisions');
    }
    return { checked, settled };
  } catch (err) {
    log.warn({ err, taskId }, '[decision-ledger] settlement failed (non-fatal)');
    return { checked: 0, settled: 0 };
  }
}
