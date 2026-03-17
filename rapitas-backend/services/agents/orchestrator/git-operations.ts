/**
 * GitOperations
 *
 * Git-related operations extracted from AgentOrchestrator.
 * Includes worktree management for parallel task isolation.
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { randomBytes } from 'crypto';
import { createLogger } from '../../../config/logger';

const execAsync = promisify(exec);
const logger = createLogger('git-operations');

/** Directory name under baseDir where worktrees are created */
const WORKTREE_DIR = '.worktrees';

/**
 * Provides Git operations (diff, commit, branch, PR, merge, revert).
 */
export class GitOperations {
  /**
   * Get git diff for a working directory.
   */
  async getGitDiff(workingDirectory: string): Promise<string> {
    try {
      const { stdout } = await execAsync('git diff', {
        cwd: workingDirectory,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (error) {
      logger.error({ err: error }, 'Failed to get git diff');
      return '';
    }
  }

  /**
   * Get full diff including unstaged changes and untracked files.
   */
  async getFullGitDiff(workingDirectory: string): Promise<string> {
    try {
      const { stdout: staged } = await execAsync('git diff --cached', {
        cwd: workingDirectory,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      const { stdout: unstaged } = await execAsync('git diff', {
        cwd: workingDirectory,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
      });
      const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard', {
        cwd: workingDirectory,
        encoding: 'utf8',
      });

      let result = '';
      if (staged) result += '=== Staged Changes ===\n' + staged + '\n';
      if (unstaged) result += '=== Unstaged Changes ===\n' + unstaged + '\n';
      if (untracked.trim()) result += '=== New Files ===\n' + untracked + '\n';

      return result || 'No changes detected';
    } catch (error) {
      logger.error({ err: error }, 'Failed to get full git diff');
      return '';
    }
  }

  /**
   * Commit changes.
   */
  async commitChanges(
    workingDirectory: string,
    message: string,
    taskTitle?: string,
  ): Promise<{ success: boolean; commitHash?: string; error?: string }> {
    try {
      await execAsync('git add -A', { cwd: workingDirectory });

      const fullMessage = taskTitle
        ? `${message}\n\nTask: ${taskTitle}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`
        : `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

      await execAsync(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, {
        cwd: workingDirectory,
        encoding: 'utf8',
      });

      const { stdout: hash } = await execAsync('git rev-parse HEAD', {
        cwd: workingDirectory,
        encoding: 'utf8',
      });

      return { success: true, commitHash: hash.trim() };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a pull request.
   */
  async createPullRequest(
    workingDirectory: string,
    title: string,
    body: string,
    baseBranch: string = 'main',
  ): Promise<{
    success: boolean;
    prUrl?: string;
    prNumber?: number;
    error?: string;
  }> {
    try {
      const ghPath =
        process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';

      const { stdout: currentBranch } = await execAsync('git branch --show-current', {
        cwd: workingDirectory,
        encoding: 'utf8',
      });

      await execAsync(`git push -u origin ${currentBranch.trim()}`, {
        cwd: workingDirectory,
      });

      const { stdout } = await execAsync(
        `${ghPath} pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --base ${baseBranch}`,
        { cwd: workingDirectory, encoding: 'utf8' },
      );

      const prUrl = stdout.trim();
      const prMatch = prUrl.match(/\/pull\/(\d+)/);

      if (!prMatch || !prMatch[1]) {
        return { success: false, error: 'Failed to parse PR number from URL' };
      }

      const prNumber = prMatch ? parseInt(prMatch[1], 10) : undefined;

      return { success: true, prUrl, prNumber };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Auto-merge a PR.
   * Uses squash merge when commit count >= threshold, otherwise merge commit.
   */
  async mergePullRequest(
    workingDirectory: string,
    prNumber: number,
    commitThreshold: number = 5,
    baseBranch: string = 'master',
  ): Promise<{
    success: boolean;
    mergeStrategy?: 'squash' | 'merge';
    error?: string;
  }> {
    try {
      const ghPath =
        process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';

      const { stdout } = await execAsync(
        `${ghPath} pr view ${prNumber} --json commits --jq ".commits | length"`,
        { cwd: workingDirectory, encoding: 'utf8' },
      );
      const commitCount = parseInt(stdout.trim(), 10) || 1;
      const mergeStrategy = commitCount >= commitThreshold ? 'squash' : 'merge';
      const mergeFlag = mergeStrategy === 'squash' ? '--squash' : '--merge';

      await execAsync(`${ghPath} pr merge ${prNumber} ${mergeFlag} --delete-branch`, {
        cwd: workingDirectory,
        encoding: 'utf8',
      });

      await execAsync(`git checkout ${baseBranch}`, {
        cwd: workingDirectory,
      });
      await execAsync('git pull', { cwd: workingDirectory });

      return { success: true, mergeStrategy };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Revert all changes.
   */
  async revertChanges(workingDirectory: string): Promise<boolean> {
    try {
      await execAsync('git reset HEAD', { cwd: workingDirectory });
      await execAsync('git checkout -- .', { cwd: workingDirectory });
      await execAsync('git clean -fd', { cwd: workingDirectory });
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to revert changes');
      return false;
    }
  }

  /**
   * Create a new branch and check it out.
   */
  async createBranch(workingDirectory: string, branchName: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`git branch --list ${branchName}`, {
        cwd: workingDirectory,
      });

      if (stdout.trim()) {
        logger.info(`[createBranch] Branch ${branchName} already exists, checking out`);
        await execAsync(`git checkout ${branchName}`, {
          cwd: workingDirectory,
        });
      } else {
        logger.info(`[createBranch] Creating new branch ${branchName}`);
        await execAsync(`git checkout -b ${branchName}`, {
          cwd: workingDirectory,
        });
      }
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to create/checkout branch');
      return false;
    }
  }

  /**
   * Create a commit (full-featured version with stats).
   */
  async createCommit(
    workingDirectory: string,
    message: string,
  ): Promise<{
    hash: string;
    branch: string;
    filesChanged: number;
    additions: number;
    deletions: number;
  }> {
    const { stdout: currentBranch } = await execAsync('git branch --show-current', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });
    const branch = currentBranch.trim();

    if (branch === 'main' || branch === 'master' || branch === 'develop') {
      const timestamp = Date.now();
      const featureBranch = `feature/auto-${timestamp}`;
      await execAsync(`git checkout -b ${featureBranch}`, {
        cwd: workingDirectory,
      });
    }

    await execAsync('git add -A', { cwd: workingDirectory });

    const { stdout: diffStat } = await execAsync('git diff --cached --numstat', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    let filesChanged = 0;
    let additions = 0;
    let deletions = 0;

    diffStat
      .split('\n')
      .filter(Boolean)
      .forEach((line) => {
        const parts = line.split('\t');
        if (parts.length >= 2) {
          filesChanged++;
          const added = parseInt(parts[0]!, 10) || 0;
          const deleted = parseInt(parts[1]!, 10) || 0;
          additions += added;
          deletions += deleted;
        }
      });

    const fullMessage = `${message}\n\nCo-Authored-By: Claude Code <noreply@anthropic.com>`;

    await execAsync(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    const { stdout: hash } = await execAsync('git rev-parse HEAD', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    const { stdout: finalBranch } = await execAsync('git branch --show-current', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    return {
      hash: hash.trim(),
      branch: finalBranch.trim(),
      filesChanged,
      additions,
      deletions,
    };
  }

  /**
   * Get diff in a structured format.
   */
  async getDiff(workingDirectory: string): Promise<
    Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>
  > {
    const files: Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch?: string;
    }> = [];

    try {
      const { stdout: stagedNumstat } = await execAsync('git diff --cached --numstat', {
        cwd: workingDirectory,
        encoding: 'utf8',
      });

      const { stdout: unstagedNumstat } = await execAsync('git diff --numstat', {
        cwd: workingDirectory,
        encoding: 'utf8',
      });

      const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard', {
        cwd: workingDirectory,
        encoding: 'utf8',
      });

      const { stdout: status } = await execAsync('git status --porcelain', {
        cwd: workingDirectory,
        encoding: 'utf8',
      });

      const fileMap = new Map<
        string,
        {
          additions: number;
          deletions: number;
          status: string;
        }
      >();

      const parseNumstat = (numstat: string) => {
        numstat
          .split('\n')
          .filter(Boolean)
          .forEach((line) => {
            const parts = line.split('\t');
            if (parts.length >= 3) {
              const additions = parseInt(parts[0]!, 10) || 0;
              const deletions = parseInt(parts[1]!, 10) || 0;
              const filename = parts[2]!;
              const existing = fileMap.get(filename);
              fileMap.set(filename, {
                additions: (existing?.additions || 0) + additions,
                deletions: (existing?.deletions || 0) + deletions,
                status: existing?.status || 'modified',
              });
            }
          });
      };

      parseNumstat(stagedNumstat);
      parseNumstat(unstagedNumstat);

      untracked
        .split('\n')
        .filter(Boolean)
        .forEach((filename) => {
          if (!fileMap.has(filename)) {
            fileMap.set(filename, {
              additions: 0,
              deletions: 0,
              status: 'added',
            });
          }
        });

      status
        .split('\n')
        .filter(Boolean)
        .forEach((line) => {
          const statusCode = line.substring(0, 2);
          const filename = line.substring(3);
          const existing = fileMap.get(filename);
          let fileStatus = 'modified';

          if (statusCode.includes('A') || statusCode.includes('?')) {
            fileStatus = 'added';
          } else if (statusCode.includes('D')) {
            fileStatus = 'deleted';
          } else if (statusCode.includes('R')) {
            fileStatus = 'renamed';
          }

          if (existing) {
            existing.status = fileStatus;
          } else {
            fileMap.set(filename, {
              additions: 0,
              deletions: 0,
              status: fileStatus,
            });
          }
        });

      for (const [filename, info] of fileMap) {
        let patch = '';
        try {
          if (info.status !== 'added') {
            const { stdout: filePatch } = await execAsync(`git diff HEAD -- "${filename}"`, {
              cwd: workingDirectory,
              encoding: 'utf8',
              maxBuffer: 5 * 1024 * 1024,
            });
            patch = filePatch;
          }
        } catch {}

        files.push({
          filename,
          status: info.status,
          additions: info.additions,
          deletions: info.deletions,
          patch: patch || undefined,
        });
      }

      return files;
    } catch (error) {
      logger.error({ err: error }, 'Failed to get diff');
      return [];
    }
  }

  // ==================== Worktree Operations ====================

  /**
   * Create a git worktree with a new branch for isolated task execution.
   *
   * @param baseDir - The main repository root / メインリポジトリのルート
   * @param branchName - Branch name to create in the worktree / worktree内に作成するブランチ名
   * @param taskId - Task ID used to generate the worktree directory name / ディレクトリ名生成用タスクID
   * @returns Absolute path to the created worktree / 作成されたworktreeの絶対パス
   * @throws {Error} When git worktree add fails / git worktree addが失敗した場合
   */
  async createWorktree(baseDir: string, branchName: string, taskId?: number): Promise<string> {
    const shortId = randomBytes(4).toString('hex');
    const dirName = taskId ? `task-${taskId}-${shortId}` : `wt-${shortId}`;
    const worktreePath = join(baseDir, WORKTREE_DIR, dirName);

    // NOTE: Quote paths to handle Windows paths with spaces
    const quotedPath = `"${worktreePath}"`;

    try {
      // Check if branch already exists
      const { stdout: existingBranch } = await execAsync(`git branch --list ${branchName}`, {
        cwd: baseDir,
        encoding: 'utf8',
      });

      if (existingBranch.trim()) {
        // Branch exists — create worktree with existing branch
        logger.info(
          `[createWorktree] Branch ${branchName} exists, creating worktree at ${worktreePath}`,
        );
        await execAsync(`git worktree add ${quotedPath} ${branchName}`, {
          cwd: baseDir,
          encoding: 'utf8',
        });
      } else {
        // Create worktree with new branch
        logger.info(
          `[createWorktree] Creating worktree at ${worktreePath} with new branch ${branchName}`,
        );
        await execAsync(`git worktree add -b ${branchName} ${quotedPath}`, {
          cwd: baseDir,
          encoding: 'utf8',
        });
      }

      logger.info(`[createWorktree] Worktree created: ${worktreePath} (branch: ${branchName})`);
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
   */
  async removeWorktree(baseDir: string, worktreePath: string): Promise<void> {
    try {
      const quotedPath = `"${worktreePath}"`;

      await execAsync(`git worktree remove ${quotedPath} --force`, {
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
        try {
          await rm(worktreePath, { recursive: true, force: true });
          logger.info(`[removeWorktree] Cleaned up directory: ${worktreePath}`);
        } catch (fsError) {
          logger.error(
            { err: fsError },
            `[removeWorktree] Failed to clean up directory: ${worktreePath}`,
          );
        }
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
  async cleanupStaleWorktrees(baseDir: string): Promise<number> {
    let cleanedCount = 0;

    try {
      // Prune metadata for worktrees whose directories no longer exist
      await execAsync('git worktree prune', { cwd: baseDir });

      // List remaining worktrees
      const { stdout } = await execAsync('git worktree list --porcelain', {
        cwd: baseDir,
        encoding: 'utf8',
      });

      const worktreeDir = join(baseDir, WORKTREE_DIR);
      const entries = stdout.split('\n\n').filter(Boolean);

      for (const entry of entries) {
        const pathMatch = entry.match(/^worktree\s+(.+)$/m);
        if (!pathMatch?.[1]) continue;

        const wtPath = pathMatch[1];
        // Only clean up worktrees under our managed .worktrees/ directory
        if (!wtPath.startsWith(worktreeDir)) continue;

        logger.info(`[cleanupStaleWorktrees] Removing stale worktree: ${wtPath}`);
        try {
          await this.removeWorktree(baseDir, wtPath);
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
}
