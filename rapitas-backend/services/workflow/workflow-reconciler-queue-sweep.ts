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
import { resolveTaskWorkflowState, taskRowConfirmedAbsent } from '../task/task-resolver';
import { isTaskTerminalForQueue } from './queue-terminal-task-guard';
import { taskVanishedMessage } from './queue-vanished-task-policy';

const log = createLogger('workflow-reconciler-queue-sweep');

/**
 * Cancel queued items whose task is already terminal (done/cancelled/completed)
 * OR whose task row is confirmed absent (deleted). CAS on status='queued' so a
 * concurrent dequeue that just promoted the item to 'running' is never
 * clobbered. Null task lookups from an unresolvable/transient DB error are
 * left alone — only a CONFIRMED absence or POSITIVE terminal evidence cancels.
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
    const terminal = isTaskTerminalForQueue(task);
    // Confirmed-vanished-task guard (task 651): the dequeue-time guard only
    // fires while a WorkflowRunner is polling — this sweep is what catches a
    // deleted task's leftover 'queued' item while auto-run is idle/paused.
    const vanished = !task && !terminal && (await taskRowConfirmedAbsent(item.taskId));
    if (!terminal && !vanished) continue;

    const updated = await prisma.workflowQueueItem
      .updateMany({
        where: { id: item.id, status: 'queued' },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          errorMessage: vanished
            ? taskVanishedMessage(item.taskId)
            : 'タスクは既に終端状態のため、残留キュー項目を自動キャンセルしました（定期スイープ）',
        },
      })
      .catch(() => ({ count: 0 }));
    if (updated.count >= 1) {
      cancelled++;
      log.info(
        { queueItemId: item.id, taskId: item.taskId, vanished },
        '[reconciler] Cancelled stale queue item for terminal or vanished task',
      );
    }
  }
  return cancelled;
}
