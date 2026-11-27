/**
 * ExecutionLedger
 *
 * In-memory register of the tasks whose phase is being started or run through
 * `WorkflowOrchestrator.advanceWorkflow`, whoever called it (the runner, a
 * delayed re-dispatch, an auto-approve, an HTTP handler). Lets the restart check
 * see a direct advance that has no queue item and may not yet have an execution
 * row. Memory only: after a restart nothing is running, so nothing needs to
 * survive. Not responsible for deciding whether an advance may start.
 */

/** A registration older than this no longer counts (backstop for a release that never ran). */
export const LEDGER_ENTRY_MAX_AGE_MS = 6 * 60 * 60 * 1000;
import { createLogger } from '../../../config/logger';
const log = createLogger('execution-ledger');

interface LedgerEntry {
  taskId: number;
  registeredAt: number;
  warned?: boolean;
}

const entries = new Map<symbol, LedgerEntry>();

/**
 * Register one running advance of a task.
 *
 * @param taskId - Task being advanced / 進めているタスクID
 * @param now - Clock override for tests / 現在時刻（テスト用）
 * @returns Release function; safe to call more than once / 解除関数（多重呼び出し可）
 */
export function registerExecution(taskId: number, now: number = Date.now()): () => void {
  const key = Symbol(`advance:${taskId}`);
  entries.set(key, { taskId, registeredAt: now });
  return () => {
    entries.delete(key);
  };
}

/**
 * Task ids with a registered advance, one per task.
 *
 * Entries older than LEDGER_ENTRY_MAX_AGE_MS are skipped so a release that never
 * ran cannot hold a restart back for good.
 *
 * @param now - Clock override for tests / 現在時刻（テスト用）
 * @returns Distinct task ids / 重複排除したタスクID
 */
export function getLedgerTaskIds(now: number = Date.now()): number[] {
  const ids = new Set<number>();
  for (const entry of entries.values()) {
    if (now - entry.registeredAt < LEDGER_ENTRY_MAX_AGE_MS) ids.add(entry.taskId);
    else if (!entry.warned) {
      entry.warned = true;
      log.warn(
        { taskId: entry.taskId, registeredAt: entry.registeredAt },
        '実行台帳の登録が6時間を超えたため再起動の観測から除外しました',
      );
    }
  }
  return [...ids];
}

/** Forget every entry (tests). */
export function resetExecutionLedger(): void {
  entries.clear();
}
