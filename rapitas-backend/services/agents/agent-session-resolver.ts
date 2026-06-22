/**
 * Agent Session Resolver
 *
 * Single source of truth for resolving the most recent worktree-bearing agent session.
 * Not responsible for HTTP handling, file I/O, or session mutations.
 */
import { prisma } from '../../config/database';

/** Resolved worktree session data. / ワークツリーセッションデータ */
export interface LatestWorktreeSession {
  /** Absolute local path of the git worktree, or null when none recorded. / gitワークツリーのパス */
  worktreePath: string | null;
  /** Branch name of the worktree, or null when none recorded. / ワークツリーのブランチ名 */
  branchName: string | null;
}

/**
 * Resolve the most recent agent session that has a worktree path for the given task.
 * Returns null when no such session exists or a DB error occurs.
 *
 * @param taskId - The task id to resolve. / 解決するタスクID
 * @returns Latest worktree session data, or null. / 最新のワークツリーセッションデータ、無ければnull
 */
export async function resolveLatestWorktreeSession(
  taskId: number,
): Promise<LatestWorktreeSession | null> {
  const session = await prisma.agentSession
    .findFirst({
      where: {
        config: { taskId },
        worktreePath: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { worktreePath: true, branchName: true },
    })
    .catch(() => null);
  if (!session) return null;
  return {
    worktreePath: session.worktreePath,
    branchName: session.branchName ?? null,
  };
}
