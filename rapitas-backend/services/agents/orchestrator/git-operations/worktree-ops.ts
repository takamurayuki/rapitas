/**
 * GitOperations — Worktree Operations
 *
 * Git worktree lifecycle management: create, remove, and cleanup of stale entries.
 * Repository and remote initialization is handled by repository-setup.ts.
 * All destructive operations are guarded by isPathSafeForWorktreeOperation from safety.ts.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync } from 'fs';
import { rm, stat } from 'fs/promises';
import { randomBytes } from 'crypto';
import { createLogger } from '../../../../config/logger';
import { WORKTREE_DIR, normalizePath, isPathSafeForWorktreeOperation } from './safety';
import { ensureGitRepository, validateAndSetupRemote } from './repository-setup';
import { prisma } from '../../../../config/database';

export { ensureGitRepository, validateAndSetupRemote };

const execAsync = promisify(exec);
const logger = createLogger('git-operations/worktree-ops');

/**
 * Create a git worktree with a new branch for isolated task execution.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @param branchName - Branch name to create in the worktree / worktree内に作成するブランチ名
 * @param taskId - Task ID used to generate the worktree directory name / ディレクトリ名生成用タスクID
 * @param repositoryUrl - Expected remote URL for validation / 検証用の期待されるリモートURL
 * @returns Absolute path to the created worktree / 作成されたworktreeの絶対パス
 * @throws {Error} When git worktree add fails / git worktree addが失敗した場合
 */
export async function createWorktree(
  baseDir: string,
  branchName: string,
  taskId?: number,
  repositoryUrl?: string | null,
): Promise<string> {
  const isRepo = await ensureGitRepository(baseDir, repositoryUrl);
  if (!isRepo) {
    throw new Error(`Failed to initialize Git repository at ${baseDir}`);
  }

  const isRemoteValid = await validateAndSetupRemote(baseDir, repositoryUrl);
  if (!isRemoteValid && repositoryUrl) {
    logger.warn(`[createWorktree] Remote validation failed, proceeding anyway`);
  }

  const shortId = randomBytes(4).toString('hex');
  const dirName = taskId ? `task-${taskId}-${shortId}` : `wt-${shortId}`;
  const worktreePath = join(baseDir, WORKTREE_DIR, dirName);

  // NOTE: Quote paths to handle Windows paths with spaces
  const quotedPath = `"${worktreePath}"`;

  try {
    let effectiveBranchName = branchName;
    try {
      const { stdout: worktreeList } = await execAsync('git worktree list --porcelain', {
        cwd: baseDir,
        encoding: 'utf8',
      });

      const branchInUse = worktreeList.includes(`branch refs/heads/${branchName}`);

      if (branchInUse) {
        // Branch is already checked out in another worktree — create unique branch name
        const uniqueSuffix = taskId ? `task-${taskId}` : `wt-${shortId}`;
        effectiveBranchName = `${branchName}-${uniqueSuffix}`;
        logger.warn(
          `[createWorktree] Branch ${branchName} is already in use, using ${effectiveBranchName} instead`,
        );
      }
    } catch (listError) {
      logger.debug(`[createWorktree] Could not check worktree list: ${listError}`);
    }

    const { stdout: existingBranch } = await execAsync(
      `git branch --list ${effectiveBranchName}`,
      { cwd: baseDir, encoding: 'utf8' },
    );

    if (existingBranch.trim()) {
      logger.info(
        `[createWorktree] Branch ${effectiveBranchName} exists, creating worktree at ${worktreePath}`,
      );
      await execAsync(`git worktree add ${quotedPath} ${effectiveBranchName}`, {
        cwd: baseDir,
        encoding: 'utf8',
      });
    } else {
      let parentBranch = 'develop';
      try {
        const { stdout: developCheck } = await execAsync('git branch --list develop', {
          cwd: baseDir,
          encoding: 'utf8',
        });
        if (!developCheck.trim()) {
          const { stdout: mainCheck } = await execAsync('git branch --list main', {
            cwd: baseDir,
            encoding: 'utf8',
          });
          parentBranch = mainCheck.trim() ? 'main' : 'master';
        }
      } catch {
        parentBranch = 'main';
      }

      logger.info(
        `[createWorktree] Creating worktree at ${worktreePath} with new branch ${effectiveBranchName} from ${parentBranch}`,
      );
      await execAsync(
        `git worktree add -b ${effectiveBranchName} ${quotedPath} ${parentBranch}`,
        { cwd: baseDir, encoding: 'utf8' },
      );
    }

    logger.info(
      `[createWorktree] Worktree created: ${worktreePath} (branch: ${effectiveBranchName})`,
    );
    return worktreePath;
  } catch (error) {
    logger.error(
      { err: error },
      `[createWorktree] Failed to create worktree for branch ${branchName}`,
    );
    throw error;
  }
}

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

  let branchName: string | null = null;
  if (deleteBranch) {
    try {
      const { stdout } = await execAsync('git worktree list --porcelain', {
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

  try {
    await execAsync(`git worktree remove "${worktreePath}" --force`, {
      cwd: baseDir,
      encoding: 'utf8',
    });
    logger.info(`[removeWorktree] Removed worktree: ${worktreePath}`);
  } catch (error) {
    // NOTE: If git worktree remove fails (e.g., already deleted), try filesystem cleanup
    logger.warn({ err: error }, `[removeWorktree] git worktree remove failed, attempting fs cleanup`);

    if (existsSync(worktreePath)) {
      // NOTE: Double-check that the target is NOT a real .git directory (indicates main repo, not worktree)
      const gitDirPath = join(worktreePath, '.git');
      if (existsSync(gitDirPath)) {
        try {
          const gitStat = await stat(gitDirPath);
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

      try {
        await rm(worktreePath, { recursive: true, force: true });
        logger.info(`[removeWorktree] Cleaned up directory: ${worktreePath}`);
      } catch (fsError) {
        logger.error({ err: fsError }, `[removeWorktree] Failed to clean up directory: ${worktreePath}`);
      }
    }
  }

  if (deleteBranch && branchName) {
    try {
      const { stdout: mergedBranches } = await execAsync('git branch --merged', {
        cwd: baseDir,
        encoding: 'utf8',
      });

      const isMerged = mergedBranches
        .split('\n')
        .some((line) => line.trim() === branchName || line.trim() === `* ${branchName}`);

      if (isMerged) {
        // Use -d for merged branches (safer)
        await execAsync(`git branch -d "${branchName}"`, { cwd: baseDir, encoding: 'utf8' });
        logger.info(`[removeWorktree] Deleted merged branch: ${branchName}`);
      } else {
        // Use -D for unmerged branches (force delete)
        await execAsync(`git branch -D "${branchName}"`, { cwd: baseDir, encoding: 'utf8' });
        logger.info(`[removeWorktree] Force deleted unmerged branch: ${branchName}`);
      }
    } catch (branchError) {
      logger.warn({ err: branchError }, `[removeWorktree] Failed to delete branch ${branchName}`);
    }
  }

  // Prune stale worktree metadata regardless of removal success
  try {
    await execAsync('git worktree prune', { cwd: baseDir });
  } catch (pruneError) {
    logger.warn({ err: pruneError }, '[removeWorktree] git worktree prune failed');
  }
}

/**
 * Clean up stale worktrees left over from crashes or abnormal exits.
 * Called during server startup.
 *
 * @param baseDir - The main repository root / メインリポジトリのルート
 * @returns Number of worktrees cleaned up / クリーンアップしたworktreeの数
 */
export async function cleanupStaleWorktrees(baseDir: string): Promise<number> {
  let cleanedCount = 0;

  try {
    await execAsync('git worktree prune', { cwd: baseDir });

    const { stdout } = await execAsync('git worktree list --porcelain', {
      cwd: baseDir,
      encoding: 'utf8',
    });

    const worktreeDir = join(baseDir, WORKTREE_DIR);
    const normalizedWorktreeDir = normalizePath(worktreeDir);
    const entries = stdout.split('\n\n').filter(Boolean);

    for (const entry of entries) {
      const pathMatch = entry.match(/^worktree\s+(.+)$/m);
      if (!pathMatch?.[1]) continue;

      const wtPath = pathMatch[1];
      // NOTE: Use normalized path comparison to handle Windows path separator differences
      const normalizedWtPath = normalizePath(wtPath);
      if (!normalizedWtPath.startsWith(normalizedWorktreeDir + '/')) continue;

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
 * @returns Number of worktrees cleaned up / クリーンアップしたworktreeの数
 */
export async function cleanupOrphanedWorktrees(baseDir: string): Promise<number> {
  let cleanedCount = 0;

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

    logger.info(
      `[cleanupOrphanedWorktrees] Found ${orphanedSessions.length} orphaned sessions with worktree paths`
    );

    for (const session of orphanedSessions) {
      if (!session.worktreePath) continue;

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
          `[cleanupOrphanedWorktrees] Cleaned up worktree for session ${session.id} (${session.status}): ${session.worktreePath}`
        );
      } catch (error) {
        logger.warn(
          { err: error },
          `[cleanupOrphanedWorktrees] Failed to clean up session ${session.id} worktree: ${session.worktreePath}`
        );
      }
    }

    // Also check for filesystem orphans (directories that git no longer tracks)
    const worktreeDir = join(baseDir, WORKTREE_DIR);
    if (existsSync(worktreeDir)) {
      try {
        const { stdout: gitWorktreeList } = await execAsync('git worktree list --porcelain', {
          cwd: baseDir,
          encoding: 'utf8',
        });

        const gitTrackedPaths = new Set<string>();
        const entries = gitWorktreeList.split('\n\n').filter(Boolean);

        for (const entry of entries) {
          const pathMatch = entry.match(/^worktree\s+(.+)$/m);
          if (pathMatch?.[1]) {
            gitTrackedPaths.add(normalizePath(pathMatch[1]));
          }
        }

        // Check filesystem directories against git-tracked worktrees
        const { readdir } = await import('fs/promises');
        const dirEntries = await readdir(worktreeDir, { withFileTypes: true });

        for (const dirEntry of dirEntries) {
          if (!dirEntry.isDirectory()) continue;

          const dirPath = join(worktreeDir, dirEntry.name);
          const normalizedDirPath = normalizePath(dirPath);

          // If directory exists but is not tracked by git, it's an orphan
          if (!gitTrackedPaths.has(normalizedDirPath)) {
            if (isPathSafeForWorktreeOperation(dirPath, baseDir)) {
              try {
                await rm(dirPath, { recursive: true, force: true });
                cleanedCount++;
                logger.info(
                  `[cleanupOrphanedWorktrees] Removed orphaned filesystem directory: ${dirPath}`
                );
              } catch (fsError) {
                logger.warn(
                  { err: fsError },
                  `[cleanupOrphanedWorktrees] Failed to remove orphaned directory: ${dirPath}`
                );
              }
            } else {
              logger.warn(
                `[cleanupOrphanedWorktrees] Skipped unsafe path: ${dirPath}`
              );
            }
          }
        }
      } catch (error) {
        logger.warn(
          { err: error },
          '[cleanupOrphanedWorktrees] Failed to check filesystem orphans'
        );
      }
    }

    if (cleanedCount > 0) {
      logger.info(`[cleanupOrphanedWorktrees] Cleaned up ${cleanedCount} orphaned worktrees`);
    }
  } catch (error) {
    logger.error(
      { err: error },
      '[cleanupOrphanedWorktrees] Failed to clean up orphaned worktrees'
    );
  }

  return cleanedCount;
}
