/**
 * queue-retry
 *
 * Decides whether a failed queue item is re-queued, cancelled or failed.
 * Extracted from workflow-queue.ts (file-size split). Not responsible for
 * running the phase again — the runner dequeues the re-queued item.
 */
import { prisma } from '../../../config';
import { createLogger } from '../../../config/logger';
import { isProviderOutageFailure } from '../queue-provider-gate';
import { isNonRunnableTaskSkip } from '../queue-skip-policy';

// Same logger name as before the split, so log queries keep matching.
const log = createLogger('workflow-queue');

/**
 * Check if retry is possible and execute retry.
 *
 * @param itemId - Failed queue item. / 失敗したキュー項目ID
 * @param reason - Failure reason, if known. / 失敗理由
 * @param markFailed - Marks the item failed with a message. / 項目を failed にする処理
 * @returns True when the item was re-queued. / 再投入した場合は true
 */
export async function retryQueueItem(
  itemId: number,
  reason: string | undefined,
  markFailed: (errorMessage: string) => Promise<unknown>,
): Promise<boolean> {
  const item = await prisma.workflowQueueItem.findUnique({ where: { id: itemId } });
  if (!item) return false;

  // Do NOT resurrect an item that was stopped/cancelled externally (e.g. the
  // user stopped auto-run, which cancels the queue item AND kills the agent).
  // The kill makes the phase fail, and without this guard the failure path
  // re-queued the cancelled item back to 'queued' → it was re-dequeued and a
  // NEW agent spawned, so "stop" never actually stopped. Manual stop is not
  // driven by this runner loop, which is why only auto-run was affected.
  if (item.status === 'cancelled' || item.status === 'completed') {
    log.info(
      `[WorkflowQueue] Skipping retry for item ${itemId} — already ${item.status} (external stop)`,
    );
    return false;
  }

  // The task cannot run at all right now (blocked / awaiting an answer /
  // workflow disabled). Retrying re-asks the same question three times and
  // overwrites the REAL reason the task stopped with the skip message, which
  // is what made these tasks impossible to diagnose. Cancel the item and keep
  // whatever reason is already recorded; the scheduler re-enqueues the task
  // once it becomes runnable again.
  if (isNonRunnableTaskSkip(reason)) {
    await prisma.workflowQueueItem.update({
      where: { id: itemId },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    log.info(
      { itemId, taskId: item.taskId, reason },
      '[WorkflowQueue] Task is not runnable — cancelled without consuming a retry',
    );
    return false;
  }

  // A provider outage says nothing about this task, so it must not spend one
  // of its finite retries. Re-queue at the same retryCount; the dequeue gate
  // keeps this from becoming a hot loop while the provider cools.
  if (await isProviderOutageFailure(reason)) {
    await prisma.workflowQueueItem.update({
      where: { id: itemId },
      data: { status: 'queued', startedAt: null, errorMessage: reason ?? null },
    });
    log.warn(
      { itemId, retryCount: item.retryCount, reason },
      '[WorkflowQueue] Provider outage — re-queued without consuming a retry',
    );
    return true;
  }

  if (item.retryCount >= item.maxRetries) {
    // Preserve the underlying failure reason instead of masking every
    // failure behind the generic "Max retries exceeded" message.
    await markFailed(
      reason
        ? `Max retries (${item.maxRetries}) exceeded — last error: ${reason}`
        : `Max retries (${item.maxRetries}) exceeded`,
    );
    return false;
  }

  await prisma.workflowQueueItem.update({
    where: { id: itemId },
    data: {
      status: 'queued',
      retryCount: item.retryCount + 1,
      startedAt: null,
      // Keep the latest failure reason visible while queued for the retry.
      errorMessage: reason ?? null,
    },
  });
  log.info(`[WorkflowQueue] Retry ${item.retryCount + 1}/${item.maxRetries} for item ${itemId}`);
  return true;
}
