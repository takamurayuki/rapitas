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

    // NOTE: Several AgentSession rows for one task can share a worktree
    // directory (retries, self-repair bounces), so group by path before
    // calling removeWorktree — tearing the same directory down once per
    // session makes every attempt after the first look like a failure. Ported
    // from completed-task-cleanup's own copy of this loop (#825), which now
    // delegates here rather than keeping a second version.
    const sessionIdsByPath = new Map<string, number[]>();
    for (const session of sessionsWithWorktrees) {
      if (!session.worktreePath) continue;
      const ids = sessionIdsByPath.get(session.worktreePath);
      if (ids) ids.push(session.id);
      else sessionIdsByPath.set(session.worktreePath, [session.id]);
    }

    for (const [worktreePath, sessionIds] of sessionIdsByPath) {
      try {
        const removed = await removeWorktree(
          resolveWorktreeBaseDir(worktreePath, dirs),
          worktreePath,
        );
        if (!removed) {
          logger.warn(`[tasks] worktree remove refused: task ${taskId} ${worktreePath}`);
          continue;
        }
        await prisma.agentSession.updateMany({
          where: { id: { in: sessionIds } },
          data: { worktreePath: null },
        });
        logger.info(`[tasks] Cleaned up worktree for task ${taskId}: ${worktreePath}`);
      } catch (worktreeError) {
        logger.warn(
          { err: worktreeError },
          `[tasks] Failed to clean up worktree for task ${taskId}: ${worktreePath}`,
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
