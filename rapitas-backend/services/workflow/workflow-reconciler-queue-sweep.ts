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

  // Tasks that can never be dispatched: the orchestrator refuses a `blocked`
  // task outright and selection refuses a halted one. Read once for the whole
  // sweep. These leftovers do not merely sit there — an auto-run queue item
  // counts toward the concurrency cap while merely 'queued', so with the cap at
  // 1 one of them stops the theme advancing at all: no next task, no dry point,
  // and therefore no nightly refill. Measured 2026-09-27: task 1105's queued
  // item held the only slot from 06:48 and the theme emitted no cycle event for
  // four hours, until the item was withdrawn by hand.
  const unrunnableIds = new Set(
    (
      await prisma.task
        .findMany({
          where: {
            id: { in: candidates.map((item) => item.taskId) },
            OR: [{ haltReason: { not: null } }, { status: 'blocked' }],
          },
          select: { id: true },
        })
        .catch(() => [] as { id: number }[])
    ).map((task) => task.id),
  );

  let cancelled = 0;
  for (const item of candidates) {
    const task = await resolveTaskWorkflowState(item.taskId);
    const terminal = isTaskTerminalForQueue(task);
    // Confirmed-vanished-task guard (task 651): the dequeue-time guard only
    // fires while a WorkflowRunner is polling — this sweep is what catches a
    // deleted task's leftover 'queued' item while auto-run is idle/paused.
    const vanished = !task && !terminal && (await taskRowConfirmedAbsent(item.taskId));
    const unrunnable = unrunnableIds.has(item.taskId);
    if (!terminal && !vanished && !unrunnable) continue;

    const updated = await prisma.workflowQueueItem
      .updateMany({
        where: { id: item.id, status: 'queued' },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          errorMessage: vanished
            ? taskVanishedMessage(item.taskId)
            : unrunnable && !terminal
              ? 'タスクが halt / blocked で実行しえないため、キュー枠を占有していた残留項目を自動キャンセルしました（定期スイープ）'
              : 'タスクは既に終端状態のため、残留キュー項目を自動キャンセルしました（定期スイープ）',
        },
      })
      .catch(() => ({ count: 0 }));
    if (updated.count >= 1) {
      cancelled++;
      log.info(
        { queueItemId: item.id, taskId: item.taskId, vanished, unrunnable },
        '[reconciler] Cancelled stale queue item for a terminal, vanished, or unrunnable task',
      );
    }
  }
  return cancelled;
}
