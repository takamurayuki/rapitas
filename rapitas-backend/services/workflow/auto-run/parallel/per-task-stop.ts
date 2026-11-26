/**
 * per-task-stop
 *
 * Stops ONE auto-run task (task 1552) when the reason is that task alone — the
 * iteration-budget halt, the hang backstop. With companions running in the same
 * theme, the theme-wide stop would kill them too; this stops only the task's
 * tree, cancels only its queue items and settles only its executions. Changes
 * are never reverted here (the other task's work shares the repository).
 * Not responsible for the user's theme stop, which still stops every task.
 */
import type { PrismaClient } from '../../../../generated/prisma-postgres';
import { createLogger } from '../../../../config/logger';
// Namespace import: scheduler tests mock auto-run-lifecycle with a subset of exports.
import * as lifecycle from '../auto-run-lifecycle';
import { loadThemeActiveSet } from './theme-active-set';

const log = createLogger('per-task-stop');

/** What the stop did. */
export type PerTaskStopOutcome = 'theme' | 'task';

/**
 * Stop one task: theme-wide (the pre-task behaviour) when it runs alone, only
 * its own tree when companions share the theme.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param themeId - Theme / テーマID
 * @param taskId - Task to stop / 停止するタスク
 * @param reason - Error message recorded on cancelled items / 停止理由
 * @returns Which stop ran / 実施した停止
 */
export async function stopAutoRunTaskOrTheme(
  prisma: PrismaClient,
  themeId: number,
  taskId: number,
  reason = 'Auto-run stopped',
): Promise<PerTaskStopOutcome> {
  const set = await loadThemeActiveSet(prisma, themeId);
  if (
    set.companions.length === 0 &&
    (set.headTaskId === taskId || (!set.readable && set.headTaskId == null))
  ) {
    await lifecycle.stopThemeExecutionImpl(prisma, themeId, taskId);
    return 'theme';
  }
  await prisma.workflowQueueItem
    .updateMany({
      where: { themeId, taskId, status: { in: ['queued', 'running', 'waiting_approval'] } },
      data: { status: 'cancelled', completedAt: new Date(), errorMessage: reason },
    })
    .catch((err) => log.warn({ err, themeId, taskId }, 'queue item cancel failed'));
  const { stopTaskTreeAgents } = await import('../../../agents/stop-task-agents');
  const stopped = await stopTaskTreeAgents(taskId);
  const { settleStoppedTasks } = await import('../../../agents/settle-stopped-tasks');
  await settleStoppedTasks(prisma, stopped.executionIds);
  log.info(
    { themeId, taskId, executions: stopped.executionIds.length },
    'stopped one task; the other running tasks of the theme keep going',
  );
  return 'task';
}
