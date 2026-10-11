/**
 * WorktreeFilesystemOrphans
 *
 * Reclaims directories under `.worktrees/` that git no longer tracks, which the
 * database-driven sweep cannot see.
 * Deliberately removes only EMPTY directories — see the rmdir note below.
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { createLogger } from '../../../../../config/logger';
import { WORKTREE_DIR, normalizePath, isPathSafeForWorktreeOperation } from '../core/safety';
import { listRegisteredWorktrees } from './worktree-git-list';

const logger = createLogger('git-operations/worktree-ops');

/**
 * Remove `.worktrees/` directories git has no record of.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @param keepSet - Normalized paths of still-live worktrees, never touched / 稼働中パス（正規化済み）
 * @returns Number of directories removed / 削除したディレクトリ数
 */
export async function sweepFilesystemOrphans(
  baseDir: string,
  keepSet: ReadonlySet<string>,
): Promise<number> {
  const worktreeDir = join(baseDir, WORKTREE_DIR);
  if (!existsSync(worktreeDir)) return 0;

  let cleanedCount = 0;
  try {
    const gitTrackedPaths = new Set(
      (await listRegisteredWorktrees(baseDir)).map((w) => w.normalized),
    );

    const dirEntries = await fsPromises.readdir(worktreeDir, { withFileTypes: true });
    let keptDirCount = 0;

    for (const dirEntry of dirEntries) {
      if (!dirEntry.isDirectory()) continue;

      const dirPath = join(worktreeDir, dirEntry.name);
      const normalizedDirPath = normalizePath(dirPath);

      if (keepSet.has(normalizedDirPath)) {
        // Per-item "nothing to do" noise — one line per still-live task on
        // every cleanup cycle. Debug-only; see the summary below.
        logger.debug(
          `[cleanupOrphanedWorktrees] Skipping filesystem orphan — owning task is still live: ${dirPath}`,
        );
        keptDirCount++;
        continue;
      }
      // A directory git still tracks is not an orphan. NOTE: `git worktree
      // list` can transiently omit a genuinely-live worktree (e.g. mid-operation
      // on the shared .git metadata from a concurrent commit elsewhere in the
      // same repo); the keepSet check above is what keeps that gap from
      // deleting an in-use directory with no DB check at all.
      if (gitTrackedPaths.has(normalizedDirPath)) continue;

      if (!isPathSafeForWorktreeOperation(dirPath, baseDir)) {
        logger.warn(`[cleanupOrphanedWorktrees] Skipped unsafe path: ${dirPath}`);
        continue;
      }

      // Missing Git metadata is not proof that the directory has no work.
      // Non-recursive rmdir atomically refuses any nonempty directory.
      try {
        await fsPromises.rmdir(dirPath);
        cleanedCount++;
        logger.info(`[cleanupOrphanedWorktrees] Removed empty orphan directory: ${dirPath}`);
      } catch (error) {
        logger.warn(
          { err: error, dirPath },
          '[cleanupOrphanedWorktrees] Preserved nonempty or inaccessible orphan directory',
        );
      }
    }

    if (keptDirCount > 0) {
      logger.info(
        `[cleanupOrphanedWorktrees] Kept ${keptDirCount} filesystem-orphan dir(s) (owning tasks still live)`,
      );
    }
  } catch (error) {
    logger.warn({ err: error }, '[cleanupOrphanedWorktrees] Failed to check filesystem orphans');
  }

  return cleanedCount;
}
