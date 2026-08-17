/**
 * auto-run-stall-guard
 *
 * Scheduler-tick release of queue-item residue pinning a TERMINAL task as a
 * theme's currentTaskId (task 618, 事例2: a done task held for 8+ minutes).
 * The scheduler's wait branch returns silently while ANY active item exists,
 * so a leftover 'running'/'queued'/'waiting_approval' item of an already-done
 * task wedged the theme forever. Not responsible for non-terminal tasks —
 * those are the reconciler sweep's job (workflow-reconciler-queue-stall).
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { resolveTaskWorkflowState } from '../../task/task-resolver';
import { isTaskTerminalForQueue } from '../workflow-queue';
import { logCycleEvent } from '../../observability';
import { notifyStallReleased } from './auto-run-notifications';

const log = createLogger('auto-run-stall-guard');

/**
 * Cancel the active queue items of a theme's current task IF that task is
 * already terminal (done/cancelled/wf=completed). CAS on the active statuses so
 * a concurrent stop/dequeue is never clobbered — a lost race is a safe no-op.
 * Non-terminal tasks (the normal in-flight case) are left completely untouched.
 *
 * @param prisma - Prisma client instance
 * @param themeId - Theme holding the task. / 対象テーマ
 * @param currentTaskId - The theme's current task. / current タスク
 * @param currentItems - Active queue items of that task. / アクティブ項目
 * @returns Items cancelled (0 = task not terminal or CAS lost). / 解除件数
 */
export async function releaseStaleActiveItems(
  prisma: PrismaClient,
  themeId: number,
  currentTaskId: number,
  currentItems: Array<{ id: number; taskId: number; status: string }>,
): Promise<number> {
  const task = await resolveTaskWorkflowState(currentTaskId);
  // Positive terminal evidence only — a null lookup can be a transient DB
  // error and must never cancel a live task's items.
  if (!isTaskTerminalForQueue(task)) return 0;

  const ids = currentItems.map((i) => i.id);
  if (ids.length === 0) return 0;

  const updated = await prisma.workflowQueueItem
    .updateMany({
      where: { id: { in: ids }, status: { in: ['queued', 'running', 'waiting_approval'] } },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorMessage:
          'タスクは既に終端状態のため、残留キュー項目を自動キャンセルしました（停滞ガード）',
      },
    })
    .catch(() => ({ count: 0 }));
  if (updated.count === 0) return 0;

  log.warn(
    { themeId, taskId: currentTaskId, released: updated.count },
    '[stall-guard] Released active queue-item residue of a terminal current task',
  );
  logCycleEvent('task.stall_released', {
    theme: themeId,
    task: currentTaskId,
    ok: true,
    cause: 'terminal_task_active_item_residue',
    count: updated.count,
    msg: 'terminal current task held active queue items — released',
  });
  await notifyStallReleased(
    themeId,
    currentTaskId,
    updated.count,
    'terminal_task_active_item_residue',
  );
  return updated.count;
}
