/**
 * WorktreeCleanupStale
 *
 * Startup/worker-init reclamation of worktrees git still has registered but no
 * live task is using.
 * Not responsible for database reconciliation (worktree-cleanup.ts) or for
 * single-worktree removal (worktree-remove.ts).
 */

import { join } from 'node:path';
import { createLogger } from '../../../../../config/logger';
import { WORKTREE_DIR, normalizePath } from '../core/safety';
import { removeWorktree } from './worktree-remove';
import {
  shouldSkipRemovalAttempt,
  recordRemovalRefused,
  clearRemovalRefusal,
  parkedRemovalCount,
} from './worktree-removal-backoff';
import { listRegisteredWorktrees, pruneWorktrees } from './worktree-git-list';

const logger = createLogger('git-operations/worktree-ops');

/**
 * Clean up stale worktrees left over from crashes or abnormal exits.
 * Called during server startup.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @param keepPaths - Worktrees of non-terminal tasks, which must survive / 残すべき稼働中 worktree
 * @returns Number of worktrees cleaned up / クリーンアップしたworktreeの数
 */
export async function cleanupStaleWorktrees(
  baseDir: string,
  keepPaths: string[] = [],
): Promise<number> {
  let cleanedCount = 0;

  try {
    await pruneWorktrees(baseDir);

    const normalizedWorktreeDir = normalizePath(join(baseDir, WORKTREE_DIR));
    const registered = await listRegisteredWorktrees(baseDir);
    // NOTE: keepPaths is the LIVENESS filter this function historically lacked:
    // despite its name it removed EVERY worktree under .worktrees/, and since
    // it runs on every worker (re)initialization — workers respawn routinely —
    // it wiped the uncommitted work of in-flight tasks (task 494: implementer
    // finished, worker recycled, verifier then saw an empty tree and bounced
    // the task into a repair loop). The caller with DB access supplies the
    // worktrees of non-terminal tasks; those must never be deleted here.
    const keepSet = new Set(keepPaths.map((p) => normalizePath(p)));
    let keptCount = 0;
    let skippedCount = 0;

    for (const { path: wtPath, normalized } of registered) {
      if (!normalized.startsWith(normalizedWorktreeDir + '/')) continue;
      if (keepSet.has(normalized)) {
        // Per-item "nothing to do" noise — this runs on every worker (re)init
        // and floods the console with one line per live task. Debug-only; see
        // the keptCount summary below for the at-a-glance signal.
        logger.debug(`[cleanupStaleWorktrees] Keeping live worktree: ${wtPath}`);
        keptCount++;
        continue;
      }

      // This sweep runs on every worker (re)init, and the reasons a removal is
      // refused (uncommitted work, lost git metadata, a held handle) persist — so
      // re-attempting within the cooldown only burns git subprocesses and
      // directory walks. See worktree-removal-backoff.ts for the measurement.
      if (shouldSkipRemovalAttempt(normalized)) {
        skippedCount++;
        continue;
      }

      logger.info(`[cleanupStaleWorktrees] Removing stale worktree: ${wtPath}`);
      try {
        const removed = await removeWorktree(baseDir, wtPath);
        if (removed) {
          cleanedCount++;
          clearRemovalRefusal(normalized);
        } else {
          recordRemovalRefused(normalized);
          logger.warn(`[cleanupStaleWorktrees] removeWorktree refused or failed: ${wtPath}`);
        }
      } catch (error) {
        recordRemovalRefused(normalized);
        logger.warn({ err: error }, `[cleanupStaleWorktrees] Failed to remove ${wtPath}`);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[cleanupStaleWorktrees] Cleaned up ${cleanedCount} stale worktrees`);
    }
    if (keptCount > 0) {
      logger.info(`[cleanupStaleWorktrees] Kept ${keptCount} live worktree(s)`);
    }
    if (skippedCount > 0) {
      // One line instead of four per worktree: the detail is the same every
      // sweep, and the count is what tells an operator the backlog is growing.
      logger.info(
        `[cleanupStaleWorktrees] Skipped ${skippedCount} worktree(s) still inside the retry cooldown (${parkedRemovalCount()} parked)`,
      );
    }
  } catch (error) {
    logger.error({ err: error }, '[cleanupStaleWorktrees] Failed to clean up stale worktrees');
  }

  return cleanedCount;
}
