/**
 * TaskWorktreeCleanup
 *
 * Removes the git worktrees an agent left behind for a task, before the task
 * is deleted.
 *
 * Lifted out of the delete route: it is fifty lines of business logic in a
 * file whose job is to define routes, and that file is already over the hard
 * size limit (COMPONENT_SPLITTING_POLICY §3-2).
 *
 * Never throws. A worktree that will not go is worth a warning, not a refused
 * deletion — the task is going away either way, and leaving the row behind
 * because a directory is stubborn helps nobody.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { getProjectRoot } from '../../config';
import { removeWorktree } from '../agents/orchestrator/git-operations/worktree/worktree-ops';
import { resolveWorktreeBaseDir } from '../agents/orchestrator/git-operations/core/resolve-worktree-base-dir';

const logger = createLogger('task-worktree-cleanup');

/**
 * Remove every worktree recorded against a task's agent sessions.
 *
 * @param taskId - The task about to be deleted / これから削除するタスク
 */
export async function cleanUpTaskWorktrees(taskId: number): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { workingDirectory: true, theme: { select: { workingDirectory: true } } },
    });
    if (!task) return;

    const sessionsWithWorktrees = await prisma.agentSession.findMany({
      where: { worktreePath: { not: null }, config: { taskId } },
      select: { id: true, worktreePath: true },
    });

    const dirs = [task.workingDirectory || task.theme?.workingDirectory, getProjectRoot()];

    for (const session of sessionsWithWorktrees) {
      if (!session.worktreePath) continue;
      try {
        const removed = await removeWorktree(
          resolveWorktreeBaseDir(session.worktreePath, dirs),
          session.worktreePath,
        );
        if (!removed) {
          logger.warn(`[tasks] worktree remove refused: task ${taskId} ${session.worktreePath}`);
          continue;
        }
        await prisma.agentSession.update({
          where: { id: session.id },
          data: { worktreePath: null },
        });
        logger.info(`[tasks] Cleaned up worktree for task ${taskId}: ${session.worktreePath}`);
      } catch (worktreeError) {
        logger.warn(
          { err: worktreeError },
          `[tasks] Failed to clean up worktree for task ${taskId}: ${session.worktreePath}`,
        );
      }
    }
  } catch (cleanupError) {
    logger.warn(
      { err: cleanupError },
      `[tasks] Failed to clean up worktrees for task ${taskId}, proceeding with deletion`,
    );
  }
}
