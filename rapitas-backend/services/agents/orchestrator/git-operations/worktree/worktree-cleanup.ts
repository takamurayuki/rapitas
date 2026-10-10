/**
 * WorktreeCleanup
 *
 * Reconciles AgentSession worktree pointers against the filesystem: removes the
 * worktrees of terminal sessions and clears the rows that pointed at them.
 * Startup reclamation lives in worktree-cleanup-stale.ts, the untracked-directory
 * sweep in worktree-filesystem-orphans.ts, and single-worktree removal in
 * worktree-remove.ts.
 */

import { createLogger } from '../../../../../config/logger';
import { normalizePath } from '../core/safety';
import { resolveWorktreeBaseDir } from '../core/resolve-worktree-base-dir';
import { prisma } from '../../../../../config/database';
import { removeWorktree } from './worktree-remove';
import { sweepTerminalTaskWorktrees } from './worktree-terminal-sweep';
import { sweepFilesystemOrphans } from './worktree-filesystem-orphans';

const logger = createLogger('git-operations/worktree-ops');

/**
 * Clean up orphaned worktrees based on database reconciliation and filesystem state.
 * Removes worktrees for completed/failed/cancelled sessions and updates the database.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @param _rmOpts - Legacy retry options retained for caller compatibility; orphan removal is nonrecursive.
 * @returns Number of worktrees cleaned up / クリーンアップしたworktreeの数
 */
export async function cleanupOrphanedWorktrees(
  baseDir: string,
  _rmOpts?: { maxAttempts?: number; sleepFn?: (ms: number) => Promise<void> },
): Promise<number> {
  let cleanedCount = 0;

  // Liveness filter: a worktree whose OWNING TASK is not terminal must survive
  // this cleanup, even if the particular AgentSession row that created it was
  // separately marked completed/failed/cancelled (a self-repair bounce, for
  // instance, leaves a stale session behind while the task keeps running in
  // the same worktree) — see worktree-keep-list.ts. Without this, running
  // this cleanup on every backend startup/restart (any trigger — including an
  // unrelated prisma schema edit — see worktree-cleanup-scheduler.ts /
  // index.ts warmup) could delete a worktree an active verifier was using
  // mid-execution (observed: task 501's implementation directory vanished and
  // was replaced by a `develop` checkout, corrupting the empty-diff check
  // into a false "no changes needed" verdict). Fail-safe: if liveness can't
  // be determined, skip this cleanup cycle entirely rather than risk deleting
  // live work.
  let keepPaths: string[];
  try {
    const { computeWorktreeKeepPaths } = await import('../../../worktree-keep-list');
    keepPaths = await computeWorktreeKeepPaths(baseDir);
  } catch (err) {
    logger.warn(
      { err },
      '[cleanupOrphanedWorktrees] Keep-list computation failed — skipping this cleanup cycle',
    );
    return 0;
  }
  const keepSet = new Set(keepPaths.map((p) => normalizePath(p)));

  try {
    cleanedCount += await reconcileTerminalSessions(keepSet);

    // Terminal-task worktrees with no (or detached) AgentSession row are invisible to the
    // session query above; reclaim them straight from the task table.
    cleanedCount += await sweepTerminalTaskWorktrees(baseDir, keepSet);

    cleanedCount += await sweepFilesystemOrphans(baseDir, keepSet);

    if (cleanedCount > 0) {
      logger.info(`[cleanupOrphanedWorktrees] Cleaned up ${cleanedCount} orphaned worktrees`);
    }
  } catch (error) {
    logger.error(
      { err: error },
      '[cleanupOrphanedWorktrees] Failed to clean up orphaned worktrees',
    );
  }

  return cleanedCount;
}

/**
 * Remove the worktrees of terminal AgentSession rows and clear their pointers.
 *
 * @param keepSet - Normalized paths whose owning task is still live / 稼働中パス（正規化済み）
 * @returns Number of worktrees removed / 削除した worktree 数
 */
async function reconcileTerminalSessions(keepSet: ReadonlySet<string>): Promise<number> {
  let cleanedCount = 0;

  const orphanedSessions = await prisma.agentSession.findMany({
    where: {
      worktreePath: { not: null },
      status: { in: ['completed', 'failed', 'cancelled'] },
    },
    select: { id: true, worktreePath: true, status: true },
  });

  // Routine bookkeeping, not a signal by itself — the "Cleaned up N" summary
  // is the line worth seeing; this only helps when actually debugging the
  // reconciliation logic.
  logger.debug(
    `[cleanupOrphanedWorktrees] Found ${orphanedSessions.length} orphaned sessions with worktree paths`,
  );

  // NOTE: A single worktree directory (task-<id>-<hash>, see
  // worktree-keep-list.ts) can be referenced by many AgentSession rows
  // (retries, self-repair bounces). Grouping by worktreePath before calling
  // removeWorktree avoids re-running git/setup-worktree.cjs once per row —
  // without it, N sessions sharing one path produced N redundant
  // removeWorktree calls (#825: 160 WARNs in ~81s for a single path).
  const sessionsByPath = new Map<string, number[]>();
  for (const session of orphanedSessions) {
    if (!session.worktreePath) continue;
    const group = sessionsByPath.get(session.worktreePath);
    if (group) group.push(session.id);
    else sessionsByPath.set(session.worktreePath, [session.id]);
  }

  let keptSessionCount = 0;

  for (const [worktreePath, sessionIds] of sessionsByPath) {
    if (keepSet.has(normalizePath(worktreePath))) {
      // Per-group "nothing to do" noise — one line per still-live task on
      // every cleanup cycle. Debug-only; see the summary after the loop.
      logger.debug(
        `[cleanupOrphanedWorktrees] Skipping ${sessionIds.length} session(s) worktree — owning task is still live: ${worktreePath}`,
      );
      keptSessionCount += sessionIds.length;
      continue;
    }

    // NOTE: The owning root comes from the PATH, not from the caller's
    // `baseDir`. One cleanup pass spans several repositories: a generated
    // project's worktree lives under that project, so checking it against
    // rapitas's root made isPathSafeForWorktreeOperation refuse it every time,
    // the pointer below was never cleared, and the same paths were retried on
    // every cycle forever (measured 2026-10-10: 70 rows / 15 paths / 5
    // projects, oldest from task 498 — the retry cost saturated the event
    // loop). Generated projects also sit under different parents, so no single
    // baseDir can cover them. Passing no candidate makes resolveWorktreeBaseDir
    // infer the root from the path, still requiring a real `.git` there, and
    // return '' when it cannot tell.
    const ownerRoot = resolveWorktreeBaseDir(worktreePath, []);
    if (!ownerRoot) {
      // Removal can never succeed for this row, so clear the pointer instead of
      // re-attempting it on every future cycle.
      await prisma.agentSession.updateMany({
        where: { id: { in: sessionIds } },
        data: { worktreePath: null },
      });
      logger.warn(
        `[cleanupOrphanedWorktrees] Unmanageable worktree path for ${sessionIds.length} session(s) — pointer cleared so it stops being retried: ${worktreePath}`,
      );
      continue;
    }

    try {
      const removed = await removeWorktree(ownerRoot, worktreePath);
      if (removed) {
        cleanedCount++;

        // Clear worktreePath on EVERY session row sharing this path — not just
        // the first — so none of them linger as future orphan candidates.
        await prisma.agentSession.updateMany({
          where: { id: { in: sessionIds } },
          data: { worktreePath: null },
        });

        logger.info(
          `[cleanupOrphanedWorktrees] Cleaned up worktree for ${sessionIds.length} session(s) (ids: ${sessionIds.join(',')}): ${worktreePath}`,
        );
      } else {
        logger.warn(
          `[cleanupOrphanedWorktrees] removeWorktree refused for ${sessionIds.length} session(s) (ids: ${sessionIds.join(',')}): ${worktreePath}`,
        );
      }
    } catch (error) {
      logger.warn(
        { err: error },
        `[cleanupOrphanedWorktrees] Failed to clean up ${sessionIds.length} session(s) (ids: ${sessionIds.join(',')}) worktree: ${worktreePath}`,
      );
    }
  }

  if (keptSessionCount > 0) {
    logger.info(
      `[cleanupOrphanedWorktrees] Kept ${keptSessionCount} session worktree(s) (owning tasks still live)`,
    );
  }

  return cleanedCount;
}
