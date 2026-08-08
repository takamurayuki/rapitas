/**
 * WorkflowReconcilerQueueSweep
 *
 * Heal pass cancelling 'queued' WorkflowQueueItems whose task already reached a
 * terminal state. The dequeue-time guard only fires when a WorkflowRunner is
 * actually polling (auto-run ARMED); with the runner idle these leftovers sat
 * forever, polluting queueDepth until someone cleaned the DB by hand (tasks
 * 537/540/545, concern #4924). Runs dequeue-independently via the reconciler.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { resolveTaskWorkflowState } from '../task/task-resolver';
import { isTaskTerminalForQueue } from './workflow-queue';

const log = createLogger('workflow-reconciler-queue-sweep');

/**
 * Cancel queued items whose task is already terminal (done/cancelled/completed).
 * CAS on status='queued' so a concurrent dequeue that just promoted the item to
 * 'running' is never clobbered. Null task lookups are left alone — a transient
 * DB error must not destroy a valid queue item (positive terminal evidence only).
 *
 * @returns Number of stale items cancelled this cycle. / キャンセル件数
 */
export async function sweepStaleQueueItems(): Promise<number> {
  const candidates = await prisma.workflowQueueItem
    .findMany({
      where: { status: 'queued' },
      select: { id: true, taskId: true },
    })
    .catch(() => []);
  if (candidates.length === 0) return 0;

  let cancelled = 0;
  for (const item of candidates) {
    const task = await resolveTaskWorkflowState(item.taskId);
    if (!isTaskTerminalForQueue(task)) continue;

    const updated = await prisma.workflowQueueItem
      .updateMany({
        where: { id: item.id, status: 'queued' },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          errorMessage:
            'タスクは既に終端状態のため、残留キュー項目を自動キャンセルしました（定期スイープ）',
        },
      })
      .catch(() => ({ count: 0 }));
    if (updated.count >= 1) {
      cancelled++;
      log.info(
        { queueItemId: item.id, taskId: item.taskId },
        '[reconciler] Cancelled stale queue item for terminal task',
      );
    }
  }
  return cancelled;
}
