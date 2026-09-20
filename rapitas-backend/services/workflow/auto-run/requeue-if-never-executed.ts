/**
 * RequeueIfNeverExecuted
 *
 * Last-chance guard shared by every place the hang backstop / terminal-failure
 * resolution is about to block a task: if it never executed, requeue it
 * (bounded) instead. Owns only the re-check + requeue decision; the callers own
 * the surrounding notices and theme bookkeeping.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';
import { taskNeverExecuted } from './auto-run-execution-presence';
import { requeueUnstartedTask } from './requeue-unstarted-task';

const log = createLogger('theme-auto-run-scheduler');

/**
 * Last-chance guard before the backstop blocks a task: requeue it when it has
 * never executed. The lookup is ALWAYS repeated here, right before the block:
 * the earlier verdict can be stale (an execution may have started meanwhile —
 * requeueing that would reset a task that is actually running) or may have
 * failed closed.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param taskId - Task about to be blocked / ブロック直前のタスク
 * @param themeId - Owning theme / テーマID
 * @returns true when requeued (do not block) / 復帰したら true
 */
export async function requeueIfNeverExecuted(
  prisma: PrismaClient,
  taskId: number,
  themeId: number,
): Promise<boolean> {
  try {
    return (
      (await taskNeverExecuted(prisma, taskId)) &&
      (await requeueUnstartedTask(prisma, taskId, themeId))
    );
  } catch (err) {
    // Fail-closed: a broken guard must fall back to the original blocked path, never crash the backstop.
    log.warn(
      `[ThemeAutoRunScheduler] Task ${taskId} last-chance requeue guard failed (${
        err instanceof Error ? err.message : String(err)
      }) — blocking as before`,
    );
    return false;
  }
}
