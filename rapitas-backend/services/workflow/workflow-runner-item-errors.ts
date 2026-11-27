/**
 * workflow-runner-item-errors
 *
 * Error settlement of the runner's per-item loop: shutdown and cancellation requeue the item
 * without spending retry budget; any other error stops the phase's agents and retries or fails the
 * item. Extracted from workflow-runner.ts (file-size split); behaviour unchanged.
 */
import { createLogger } from '../../config/logger';
import type { QueueItem } from './workflow-queue';
import { isShutdownError } from '../agents/orchestrator/shutdown-error';
import { ExecutionCancelledError } from '../agents/execution-cancelled-error';
import {
  notifyParentOnSubtaskFailure,
  stopFailedPhaseAgents,
} from './workflow-runner-item-helpers';
import { guardQueueWrites, handOffAfterAdvance } from './workflow-runner-item-claim';
import type { ItemLoopDeps } from './workflow-runner-item-loop';
import type { ActiveExecution } from './workflow-runner.types';

const log = createLogger('workflow-runner');

/**
 * Settle a queue item after its phase loop threw.
 *
 * @param deps - Runner collaborators. / ランナーの協調オブジェクト
 * @param item - The item whose loop threw. / 例外を出した項目
 * @param execution - Execution record (current phase for the broadcast). / 実行記録
 * @param error - The thrown value. / 例外
 */
export async function settleItemError(
  deps: ItemLoopDeps,
  item: QueueItem,
  execution: ActiveExecution,
  error: unknown,
): Promise<void> {
  const errorMsg = error instanceof Error ? error.message : String(error);
  // Task 1568: an item handed back for a CI wait is never rewritten by the runner that lost it.
  const queue = guardQueueWrites(deps.queue, item.id, item.taskId, () => execution.currentPhase);

  // NOTE: Shutdown errors are graceful interruptions — requeue without consuming retry budget.
  // Mirrors stopProcessing() at line 99 which also uses updateStatus(..., 'queued', ...).
  if (isShutdownError(error)) {
    log.warn(`[WorkflowRunner] Task ${item.taskId} interrupted by shutdown — requeued`);
    try {
      await queue.updateStatus(item.id, 'queued', {
        errorMessage: 'Shutdown - returned to queue',
      });
    } catch (requeueError) {
      log.warn(
        { err: requeueError },
        `[WorkflowRunner] Failed to requeue item ${item.id} after shutdown`,
      );
    }
    deps.broadcastItemUpdate(item.id, item.taskId, 'execution_error', execution.currentPhase);
    return;
  }

  // NOTE: ExecutionCancelledError signals an intentional lock-ownership revocation
  // (e.g. a manual stop/reset), not a failure. Every other catch site for this error
  // (plan-auto-approve.ts, resume-completion.ts, execution-persistence.ts,
  // execution-resume.ts, manual-execution-settlement.ts) treats it as a graceful
  // interruption; this runner previously fell through to the generic ERROR + retry
  // path, which could consume retry budget on repeated stops and eventually mark the
  // task 'failed'. Mirror the shutdown-error handling above.
  if (error instanceof ExecutionCancelledError) {
    log.warn(`[WorkflowRunner] Task ${item.taskId} cancelled — requeued: ${errorMsg}`);
    try {
      await queue.updateStatus(item.id, 'queued', {
        errorMessage: 'Shutdown - returned to queue',
      });
    } catch (requeueError) {
      log.warn(
        { err: requeueError },
        `[WorkflowRunner] Failed to requeue item ${item.id} after cancellation`,
      );
    }
    deps.broadcastItemUpdate(item.id, item.taskId, 'execution_error', execution.currentPhase);
    return;
  }

  log.error(`[WorkflowRunner] Execution error for task ${item.taskId}: ${errorMsg}`);

  if (await handOffAfterAdvance(item.id, item.taskId)) return;

  await stopFailedPhaseAgents(item.taskId, errorMsg);

  try {
    const retried = await queue.retryIfPossible(item.id, errorMsg);
    if (!retried) {
      await queue.updateStatus(item.id, 'failed', { errorMessage: errorMsg });
      // Terminal failure (no retry left) — let a split parent finalize.
      await notifyParentOnSubtaskFailure(item.taskId);
    }
  } catch (retryError) {
    log.error({ err: retryError }, `[WorkflowRunner] Failed to retry/fail item ${item.id}`);
  }
  deps.broadcastItemUpdate(item.id, item.taskId, 'execution_error', execution.currentPhase);
}
