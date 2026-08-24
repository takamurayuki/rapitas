/**
 * WorktreeRemove
 *
 * Safe removal of a single git worktree: dependency-install wait, teardown
 * script, branch-deletion safety checks, and cache invalidation.
 * Batch/startup cleanup lives in worktree-cleanup.ts.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { createLogger } from '../../../../../config/logger';
import { normalizePath, isPathSafeForWorktreeOperation } from '../core/safety';
import { clearGitCache } from '../core/git-exec';
import { clearGitRemoteCache } from '../../../../github/git-exec';
import {
  clearWorktreeDependenciesTracking,
  awaitWorktreeDependencies,
} from './dependency-installer';
import { rmDirWithRetry } from './dir-remove-retry';

// NOTE: execFile (array-args, no shell) instead of exec (shell string) — branch
// names, paths, and other caller-controlled values are passed as literal argv
// elements, so shell metacharacters in them can't be interpreted. See
// services/github/gh-client.ts for the established pattern.
const execFileAsync = promisify(execFile);
const logger = createLogger('git-operations/worktree-ops');

/**
 * Remove a git worktree and prune stale entries.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @param worktreePath - Absolute path to the worktree to remove / 削除するworktreeの絶対パス
 * @param deleteBranch - Whether to delete the associated branch (default: true) / 関連するブランチを削除するか（デフォルト: true）
 */
export async function removeWorktree(
  baseDir: string,
  worktreePath: string,
  deleteBranch: boolean = true,
): Promise<void> {
  // NOTE: Validate path before any destructive operation — prevents accidental deletion of .git/ or main repo
  if (!isPathSafeForWorktreeOperation(worktreePath, baseDir)) {
    logger.error(
      `[removeWorktree] REFUSED to remove unsafe path: ${worktreePath} (baseDir: ${baseDir})`,
    );
    return;
  }

  // NOTE: Wait for any in-flight dependency setup (setup-worktree.cjs) to complete before
  // tearing down the directory. On Windows a running node process holds handles inside
  // node_modules and causes EBUSY on the subsequent rm. When no setup is in flight
  // (e.g. after a backend restart) awaitWorktreeDependencies starts a brief idempotent
  // link-check that resolves within seconds, so rm proceeds safely either way.
  try {
    await awaitWorktreeDependencies(worktreePath);
  } catch {
    // NOTE: Setup failure is non-fatal for removal — the worker may never have needed it.
    logger.debug('[removeWorktree] awaitWorktreeDependencies failed (non-fatal), proceeding');
  }

  let branchName: string | null = null;
  if (deleteBranch) {
    try {
      const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
        cwd: baseDir,
        encoding: 'utf8',
      });

      const entries = stdout.split('\n\n').filter(Boolean);
      for (const entry of entries) {
        const pathMatch = entry.match(/^worktree\s+(.+)$/m);
        const branchMatch = entry.match(/^branch\s+refs\/heads\/(.+)$/m);

        if (pathMatch && branchMatch) {
          const normalizedEntryPath = normalizePath(pathMatch[1]!);
          const normalizedWorktreePath = normalizePath(worktreePath);

          if (normalizedEntryPath === normalizedWorktreePath) {
            branchName = branchMatch[1]!;
            logger.info(`[removeWorktree] Found branch ${branchName} for worktree ${worktreePath}`);
            break;
          }
        }
      }
    } catch (error) {
      logger.warn({ err: error }, `[removeWorktree] Failed to get branch name for worktree`);
    }
  }

  // Unlink the junctions/symlinks (node_modules, etc.) that setup-worktree.cjs
  // created BEFORE removing the worktree. On Windows, leftover junctions confuse
  // `git worktree remove` and `rm -rf`, surfacing as "Filename too long" / EPERM.
  const teardownScript = join(worktreePath, 'scripts', 'setup-worktree.cjs');
  if (existsSync(teardownScript)) {
    try {
      // NOTE: process.execPath (not the string 'node') runs the same Node/Bun
      // binary that is executing this process, and execFile array-args need no
      // quoting for the script path even when it contains spaces.
      await execFileAsync(process.execPath, [teardownScript, '--teardown'], {
        cwd: worktreePath,
        encoding: 'utf8',
      });
      logger.info('[removeWorktree] Unlinked shared resources via setup-worktree.cjs --teardown');
    } catch (tdErr) {
      logger.debug(
        { err: tdErr },
        '[removeWorktree] setup-worktree.cjs --teardown failed (non-fatal)',
      );
    }
  }

  // NOTE: Windows NTFS/junction handles can linger for ~100-200ms after the teardown
  // script closes them. This wait prevents EBUSY on the subsequent git worktree remove.
  await new Promise<void>((r) => setTimeout(r, 200));

  // NOTE: Always run `git worktree prune` BEFORE attempting remove. This
  // clears stale entries left behind by previous failed removes (commonly
  // happens when a long-running codex/install process held a file handle
  // during the prior cleanup). Without this, `git worktree remove` may
  // refuse with "is not a working tree".
  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: baseDir, encoding: 'utf8' });
  } catch (preErr) {
    logger.debug({ err: preErr }, '[removeWorktree] pre-prune failed (non-fatal)');
  }

  try {
    await execFileAsync('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: baseDir,
      encoding: 'utf8',
    });
    logger.info(`[removeWorktree] Removed worktree: ${worktreePath}`);
  } catch (error) {
    // NOTE: If git worktree remove fails (e.g., already deleted), try filesystem cleanup
    logger.warn(
      { err: error },
      `[removeWorktree] git worktree remove failed, attempting fs cleanup`,
    );

    if (existsSync(worktreePath)) {
      // NOTE: Double-check that the target is NOT a real .git directory (indicates main repo, not worktree)
      const gitDirPath = join(worktreePath, '.git');
      if (existsSync(gitDirPath)) {
        try {
          const gitStat = await fsPromises.stat(gitDirPath);
          if (gitStat.isDirectory()) {
            // SAFETY: .git is a directory — this is a main repository, NOT a worktree
            // Worktrees have a .git FILE pointing to the main repo's .git/worktrees/ entry
            logger.error(
              `[removeWorktree] REFUSED fs cleanup: ${worktreePath} contains .git directory (likely main repo, not worktree)`,
            );
            return;
          }
        } catch {
          // NOTE: stat failed — proceed with caution, but the path validation above should protect us
        }
      }

      const removed = await rmDirWithRetry(worktreePath);
      if (removed) {
        logger.info(`[removeWorktree] Cleaned up directory: ${worktreePath}`);
      } else {
        logger.warn(
          `[removeWorktree] Could not remove ${worktreePath} after retries (held handles); leaving for the cleanup scheduler`,
        );
      }
    }
  }

  if (deleteBranch && branchName) {
    try {
      const { stdout: mergedBranches } = await execFileAsync('git', ['branch', '--merged'], {
        cwd: baseDir,
        encoding: 'utf8',
      });

      const isMerged = mergedBranches
        .split('\n')
        .some((line) => line.trim() === branchName || line.trim() === `* ${branchName}`);

      if (isMerged) {
        // Use -d for merged branches (safer)
        await execFileAsync('git', ['branch', '-d', branchName], {
          cwd: baseDir,
          encoding: 'utf8',
        });
        logger.info(`[removeWorktree] Deleted merged branch: ${branchName}`);
      } else {
        // An unmerged branch is only safe to force-delete when every commit
        // is reachable from some remote ref (i.e. the work was pushed).
        // Commits that exist NOWHERE else would be destroyed with it — a
        // stop-execution did exactly that to a branch holding verified,
        // committed-but-unpushed work (task 536), recovered only via reflog.
        const { stdout: uniqueCountRaw } = await execFileAsync(
          'git',
          ['rev-list', branchName, '--not', '--remotes', '--count'],
          { cwd: baseDir, encoding: 'utf8' },
        );
        const uniqueCount = parseInt(uniqueCountRaw.trim(), 10);
        if (Number.isFinite(uniqueCount) && uniqueCount > 0) {
          const { stdout: tip } = await execFileAsync('git', ['rev-parse', '--short', branchName], {
            cwd: baseDir,
            encoding: 'utf8',
          });
          logger.warn(
            `[removeWorktree] KEEPING unmerged branch ${branchName} — ${uniqueCount} commit(s) exist on no remote (tip ${tip.trim()}). Push or recover (git checkout -b <name> ${tip.trim()}) before deleting.`,
          );
        } else {
          // All commits are on a remote — -D only drops the local ref.
          await execFileAsync('git', ['branch', '-D', branchName], {
            cwd: baseDir,
            encoding: 'utf8',
          });
          logger.info(
            `[removeWorktree] Force deleted unmerged branch (all commits pushed): ${branchName}`,
          );
        }
      }
    } catch (branchError) {
      logger.warn({ err: branchError }, `[removeWorktree] Failed to delete branch ${branchName}`);
    }
  }

  // Prune stale worktree metadata regardless of removal success
  try {
    await execFileAsync('git', ['worktree', 'prune'], { cwd: baseDir });
  } catch (pruneError) {
    logger.warn({ err: pruneError }, '[removeWorktree] git worktree prune failed');
  }

  // NOTE: Drop install tracking so a future worktree at the same path
  // (after directory reuse) does not see a stale resolved-promise.
  clearWorktreeDependenciesTracking(worktreePath);
  // NOTE: Invalidate cached git-dir values for this path. A new worktree
  // created at the same path would otherwise get the old git-dir from cache.
  clearGitCache(worktreePath);
  // NOTE: Invalidate the GitHub remote URL cache for this path so a future
  // worktree reusing the same directory cannot receive a stale owner/repo.
  clearGitRemoteCache(worktreePath);
}
