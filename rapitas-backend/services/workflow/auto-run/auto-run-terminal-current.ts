/**
 * auto-run-terminal-current
 *
 * Detects a theme whose currentTaskId points at a CANCELLED task and releases
 * it so the scheduler moves on. Without this, the re-enqueue branch put the
 * cancelled task back in the queue every tick while the stall-guard removed it
 * (task 1009). Not responsible for done/completed tasks — those keep the
 * onTaskCompleted path so processedCount stays accurate.
 */
import { createLogger } from '../../../config/logger';
import { logCycleEvent } from '../../observability';
import { releaseCurrentTaskIfMatches } from '../../task/task-terminal-current-release';
import type { PrismaClient } from '../../../generated/prisma-postgres';

const log = createLogger('theme-auto-run-scheduler');

/**
 * Whether the current task is cancelled (terminal but not "completed").
 *
 * @param task - Resolved task state / タスク状態
 * @returns true for a cancelled, non-completed task / cancelled なら true
 */
export function isCancelledCurrent(
  task: { status?: string | null; workflowStatus?: string | null } | null,
): boolean {
  return task?.status === 'cancelled' && task.workflowStatus !== 'completed';
}

/**
 * Release a cancelled current task from its theme (CAS) and record it.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme holding the task / テーマID
 * @param taskId - Cancelled current task / current タスクID
 */
export async function releaseCancelledCurrent(
  prisma: PrismaClient,
  themeId: number,
  taskId: number,
): Promise<void> {
  await releaseCurrentTaskIfMatches(prisma, taskId);
  log.info(
    `[ThemeAutoRunScheduler] Task ${taskId} is cancelled — released as current, advancing (theme ${themeId})`,
  );
  logCycleEvent('task.skipped', {
    theme: themeId,
    task: taskId,
    cause: 'terminal_current_released',
    msg: 'cancelled current task released — advancing to next',
  });
}
