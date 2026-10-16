/**
 * RequeueUnstartedTask
 *
 * Returns a task that hit the hang backstop WITHOUT ever executing to `todo`
 * and re-enqueues it, instead of blocking it. Owns only the bounded requeue;
 * the caller decides when the backstop fires and resets the theme's tenure.
 *
 * Bounded by a persisted count of `backstop_unstarted_requeue` transitions,
 * and never touches a task the iteration budget already halted (K-10720:
 * re-injecting a halted task amplifies the halt).
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { WorkflowQueueService } from '../workflow-queue';
import { recordTransition } from '../transition-recorder';

const log = createLogger('theme-auto-run-scheduler');

export const UNSTARTED_REQUEUE_CAUSE = 'backstop_unstarted_requeue';
export const MAX_UNSTARTED_REQUEUES = 3;

/**
 * Reset a never-executed task to todo and re-enqueue it.
 *
 * @param prisma - Prisma client. / Prisma クライアント
 * @param taskId - Task that hit the backstop. / バックストップ到達タスク
 * @param themeId - Theme owning the queue item. / テーマID
 * @returns true when requeued (caller must not block it); false to fall back to blocking. / 復帰できたら true
 */
export async function requeueUnstartedTask(
  prisma: PrismaClient,
  taskId: number,
  themeId: number,
): Promise<boolean> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true, workflowStatus: true, haltReason: true },
    });
    if (!task || task.haltReason) return false;
    if (task.status === 'done' || task.status === 'cancelled') return false;

    const previous = await prisma.workflowTransition.count({
      where: { taskId, cause: UNSTARTED_REQUEUE_CAUSE },
    });
    if (previous >= MAX_UNSTARTED_REQUEUES) return false;

    await prisma.task.update({ where: { id: taskId }, data: { status: 'todo' } });
    try {
      await WorkflowQueueService.getInstance().enqueue({ taskId, themeId, priority: 50 });
    } catch (err) {
      // 'already in the queue' means the original queued item survives — fine.
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('already in the queue')) throw err;
    }
    await recordTransition({
      taskId,
      fromStatus: task.workflowStatus ?? task.status,
      toStatus: task.workflowStatus ?? 'todo',
      actor: 'system',
      cause: UNSTARTED_REQUEUE_CAUSE,
      metadata: { attempt: previous + 1, max: MAX_UNSTARTED_REQUEUES, themeId },
    });
    return true;
  } catch (err) {
    log.warn(
      `[ThemeAutoRunScheduler] Task ${taskId} unstarted requeue failed (${
        err instanceof Error ? err.message : String(err)
      }) — falling back to blocking`,
    );
    return false;
  }
}
