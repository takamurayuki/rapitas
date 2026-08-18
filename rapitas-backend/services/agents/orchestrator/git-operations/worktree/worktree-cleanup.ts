/**
 * WorktreeCleanup
 *
 * Batch reclamation of worktrees: startup cleanup of stale entries and
 * DB/filesystem reconciliation of orphaned worktrees.
 * Single-worktree removal lives in worktree-remove.ts.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { createLogger } from '../../../../../config/logger';
import { WORKTREE_DIR, normalizePath, isPathSafeForWorktreeOperation } from '../core/safety';
import { prisma } from '../../../../../config/database';
import { removeWorktree } from './worktree-remove';
import { rmDirWithRetry } from './dir-remove-retry';

// NOTE: execFile (array-args, no shell) instead of exec (shell string) — branch
// names, paths, and other caller-controlled values are passed as literal argv
// elements, so shell metacharacters in them can't be interpreted. See
// services/github/gh-client.ts for the established pattern.
const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/worktree-ops');

/**
 * Clean up stale worktrees left over from crashes or abnormal exits.
 * Called during server startup.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @returns Number of worktrees cleaned up / クリーンアップしたworktreeの数
 */
export async function cleanupStaleWorktrees(
  baseDir: string,
  keepPaths: string[] = [],
): Promise<number> {
  let cleanedCount = 0;

  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: baseDir });

    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: baseDir,
      encoding: 'utf8',
    });

    const worktreeDir = join(baseDir, WORKTREE_DIR);
    const normalizedWorktreeDir = normalizePath(worktreeDir);
    const entries = stdout.split('\n\n').filter(Boolean);
    // NOTE: keepPaths is the LIVENESS filter this function historically lacked:
    // despite its name it removed EVERY worktree under .worktrees/, and since
    // it runs on every worker (re)initialization — workers respawn routinely —
    // it wiped the uncommitted work of in-flight tasks (task 494: implementer
    // finished, worker recycled, verifier then saw an empty tree and bounced
    // the task into a repair loop). The caller with DB access supplies the
    // worktrees of non-terminal tasks; those must never be deleted here.
    const keepSet = new Set(keepPaths.map((p) => normalizePath(p)));
    let keptCount = 0;

    for (const entry of entries) {
      const pathMatch = entry.match(/^worktree\s+(.+)$/m);
      if (!pathMatch?.[1]) continue;

      const wtPath = pathMatch[1];
      // NOTE: Use normalized path comparison to handle Windows path separator differences
      const normalizedWtPath = normalizePath(wtPath);
      if (!normalizedWtPath.startsWith(normalizedWorktreeDir + '/')) continue;
      if (keepSet.has(normalizedWtPath)) {
        // Per-item "nothing to do" noise — this runs on every worker (re)init
        // and floods the console with one line per live task. Debug-only; see
        // the keptCount summary below for the at-a-glance signal.
        logger.debug(`[cleanupStaleWorktrees] Keeping live worktree: ${wtPath}`);
        keptCount++;
        continue;
      }

      logger.info(`[cleanupStaleWorktrees] Removing stale worktree: ${wtPath}`);
      try {
        await removeWorktree(baseDir, wtPath);
        cleanedCount++;
      } catch (error) {
        logger.warn({ err: error }, `[cleanupStaleWorktrees] Failed to remove ${wtPath}`);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[cleanupStaleWorktrees] Cleaned up ${cleanedCount} stale worktrees`);
    }
    if (keptCount > 0) {
      logger.info(`[cleanupStaleWorktrees] Kept ${keptCount} live worktree(s)`);
    }
  } catch (error) {
    logger.error({ err: error }, '[cleanupStaleWorktrees] Failed to clean up stale worktrees');
  }

  return cleanedCount;
}

/**
 * Clean up orphaned worktrees based on database reconciliation and filesystem state.
 * Removes worktrees for completed/failed/cancelled sessions and updates the database.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @param rmOpts - Options forwarded to rmDirWithRetry (inject sleepFn/maxAttempts in tests to avoid real waits) / テスト時にsleepFnを注入してリアル待機を回避できる
 * @returns Number of worktrees cleaned up / クリーンアップしたworktreeの数
 */
export async function cleanupOrphanedWorktrees(
  baseDir: string,
  rmOpts?: { maxAttempts?: number; sleepFn?: (ms: number) => Promise<void> },
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
    // Clean up database-tracked orphaned worktrees
    const orphanedSessions = await prisma.agentSession.findMany({
      where: {
        worktreePath: { not: null },
        status: { in: ['completed', 'failed', 'cancelled'] },
      },
      select: {
        id: true,
        worktreePath: true,
        status: true,
      },
    });

    // Routine bookkeeping, not a signal by itself — the "Cleaned up N" summary
    // below is the line worth seeing; this only helps when actually debugging
    // the reconciliation logic.
    logger.debug(
      `[cleanupOrphanedWorktrees] Found ${orphanedSessions.length} orphaned sessions with worktree paths`,
    );
    let keptSessionCount = 0;

    for (const session of orphanedSessions) {
      if (!session.worktreePath) continue;
      if (keepSet.has(normalizePath(session.worktreePath))) {
        // Per-item "nothing to do" noise — one line per still-live task on
        // every cleanup cycle. Debug-only; see the summary after the loop.
        logger.debug(
          `[cleanupOrphanedWorktrees] Skipping session ${session.id} worktree — owning task is still live: ${session.worktreePath}`,
        );
        keptSessionCount++;
        continue;
      }

      try {
        // Remove the worktree if it exists
        await removeWorktree(baseDir, session.worktreePath);
        cleanedCount++;

        // Clear the worktreePath in the database
        await prisma.agentSession.update({
          where: { id: session.id },
          data: { worktreePath: null },
        });

        logger.info(
          `[cleanupOrphanedWorktrees] Cleaned up worktree for session ${session.id} (${session.status}): ${session.worktreePath}`,
        );
      } catch (error) {
        logger.warn(
          { err: error },
          `[cleanupOrphanedWorktrees] Failed to clean up session ${session.id} worktree: ${session.worktreePath}`,
        );
      }
    }
    if (keptSessionCount > 0) {
      logger.info(
        `[cleanupOrphanedWorktrees] Kept ${keptSessionCount} session worktree(s) (owning tasks still live)`,
      );
    }

    // Also check for filesystem orphans (directories that git no longer tracks)
    const worktreeDir = join(baseDir, WORKTREE_DIR);
    if (existsSync(worktreeDir)) {
      try {
        const { stdout: gitWorktreeList } = await execFileAsync(
          'git',
          ['worktree', 'list', '--porcelain'],
          {
            cwd: baseDir,
            encoding: 'utf8',
          },
        );

        const gitTrackedPaths = new Set<string>();
        const entries = gitWorktreeList.split('\n\n').filter(Boolean);

        for (const entry of entries) {
          const pathMatch = entry.match(/^worktree\s+(.+)$/m);
          if (pathMatch?.[1]) {
            gitTrackedPaths.add(normalizePath(pathMatch[1]));
          }
        }

        // Check filesystem directories against git-tracked worktrees
        const dirEntries = await fsPromises.readdir(worktreeDir, { withFileTypes: true });
        let keptDirCount = 0;

        for (const dirEntry of dirEntries) {
          if (!dirEntry.isDirectory()) continue;

          const dirPath = join(worktreeDir, dirEntry.name);
          const normalizedDirPath = normalizePath(dirPath);

          // If directory exists but is not tracked by git, it's an orphan —
          // UNLESS it belongs to a still-live task. `git worktree list` can
          // transiently omit a genuinely-live worktree (e.g. mid-operation on
          // the shared .git metadata from a concurrent commit elsewhere in
          // the same repo); trusting that gap alone would delete an in-use
          // directory outright, with no DB check at all.
          if (!gitTrackedPaths.has(normalizedDirPath) && !keepSet.has(normalizedDirPath)) {
            if (isPathSafeForWorktreeOperation(dirPath, baseDir)) {
              const removed = await rmDirWithRetry(dirPath, rmOpts);
              if (removed) {
                cleanedCount++;
                logger.info(
                  `[cleanupOrphanedWorktrees] Removed orphaned filesystem directory: ${dirPath}`,
                );
              } else {
                // NOTE: Do NOT throw — one orphan failing must not abort the entire cleanup cycle.
                logger.warn(
                  { dirPath },
                  `[cleanupOrphanedWorktrees] Failed to remove orphaned directory after retries: ${dirPath}`,
                );
              }
            } else {
              logger.warn(`[cleanupOrphanedWorktrees] Skipped unsafe path: ${dirPath}`);
            }
          } else if (keepSet.has(normalizedDirPath)) {
            // Per-item "nothing to do" noise — one line per still-live task on
            // every cleanup cycle. Debug-only; see the summary below.
            logger.debug(
              `[cleanupOrphanedWorktrees] Skipping filesystem orphan — owning task is still live: ${dirPath}`,
            );
            keptDirCount++;
          }
        }
        if (keptDirCount > 0) {
          logger.info(
            `[cleanupOrphanedWorktrees] Kept ${keptDirCount} filesystem-orphan dir(s) (owning tasks still live)`,
          );
        }
      } catch (error) {
        logger.warn(
          { err: error },
          '[cleanupOrphanedWorktrees] Failed to check filesystem orphans',
        );
      }
    }

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
