/**
 * GitOperations — Branch and Pull Request Operations
 *
 * Manages branches, pull requests, merges, and reverts.
 * Not responsible for low-level diff/commit operations or worktree management.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../../config/logger';

const execAsync = promisify(exec);
const logger = createLogger('git-operations/branch-pr-ops');

/** Path to the GitHub CLI on Windows. */
const GH_PATH_WIN = '"C:\\Program Files\\GitHub CLI\\gh.exe"';

/**
 * Resolve the path to the GitHub CLI for the current platform.
 *
 * @returns Platform-appropriate gh CLI invocation string / プラットフォームに適したgh CLI呼び出し文字列
 */
function ghPath(): string {
  return process.platform === 'win32' ? GH_PATH_WIN : 'gh';
}

/**
 * Create a new branch and check it out, or check out an existing branch.
 *
 * @param workingDirectory - Repository directory / リポジトリのディレクトリ
 * @param branchName - Branch name to create or check out / 作成またはチェックアウトするブランチ名
 * @returns true on success / 成功時true
 */
export async function createBranch(
  workingDirectory: string,
  branchName: string,
): Promise<boolean> {
  try {
    const { stdout } = await execAsync(`git branch --list ${branchName}`, {
      cwd: workingDirectory,
    });

    if (stdout.trim()) {
      logger.info(`[createBranch] Branch ${branchName} already exists, checking out`);
      await execAsync(`git checkout ${branchName}`, { cwd: workingDirectory });
    } else {
      logger.info(`[createBranch] Creating new branch ${branchName}`);
      await execAsync(`git checkout -b ${branchName}`, { cwd: workingDirectory });
    }
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Failed to create/checkout branch');
    return false;
  }
}

/**
 * Create a pull request targeting the best available base branch.
 * Automatically determines base branch (prefer develop, fallback to main/master) if not specified.
 *
 * @param workingDirectory - Repository directory / リポジトリのディレクトリ
 * @param title - PR title / PRのタイトル
 * @param body - PR description / PRの説明
 * @param baseBranch - Override base branch; auto-detected if omitted / ベースブランチ（省略時は自動検出）
 * @returns Result with success flag, PR URL, and PR number / 成功フラグ・PR URL・PR番号を含む結果
 */
export async function createPullRequest(
  workingDirectory: string,
  title: string,
  body: string,
  baseBranch?: string,
): Promise<{
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}> {
  try {
    let targetBranch = baseBranch;
    if (!targetBranch) {
      try {
        const { stdout: developCheck } = await execAsync('git branch --list develop', {
          cwd: workingDirectory,
          encoding: 'utf8',
        });
        if (developCheck.trim()) {
          targetBranch = 'develop';
        } else {
          const { stdout: mainCheck } = await execAsync('git branch --list main', {
            cwd: workingDirectory,
            encoding: 'utf8',
          });
          targetBranch = mainCheck.trim() ? 'main' : 'master';
        }
      } catch {
        targetBranch = 'main';
      }
      logger.info(`[createPullRequest] Auto-determined base branch: ${targetBranch}`);
    }

    const { stdout: currentBranch } = await execAsync('git branch --show-current', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    await execAsync(`git push -u origin ${currentBranch.trim()}`, { cwd: workingDirectory });

    const { stdout } = await execAsync(
      `${ghPath()} pr create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}" --base ${targetBranch}`,
      { cwd: workingDirectory, encoding: 'utf8' },
    );

    const prUrl = stdout.trim();
    const prMatch = prUrl.match(/\/pull\/(\d+)/);

    if (!prMatch?.[1]) {
      return { success: false, error: 'Failed to parse PR number from URL' };
    }

    const prNumber = parseInt(prMatch[1], 10);
    logger.info(`[createPullRequest] Created PR #${prNumber} to ${targetBranch}: ${prUrl}`);
    return { success: true, prUrl, prNumber };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Auto-merge a pull request.
 * Uses squash merge when commit count >= threshold, otherwise merge commit.
 *
 * @param workingDirectory - Repository directory / リポジトリのディレクトリ
 * @param prNumber - PR number to merge / マージするPR番号
 * @param commitThreshold - Minimum commit count for squash strategy (default 5) / squash戦略に切り替えるコミット数の閾値
 * @param baseBranch - Branch to check out after merge (default 'master') / マージ後にチェックアウトするブランチ
 * @returns Result with success flag and merge strategy used / 成功フラグと使用したマージ戦略を含む結果
 */
export async function mergePullRequest(
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
    const { stdout } = await execAsync(
      `${ghPath()} pr view ${prNumber} --json commits --jq ".commits | length"`,
      { cwd: workingDirectory, encoding: 'utf8' },
    );
    const commitCount = parseInt(stdout.trim(), 10) || 1;
    const mergeStrategy = commitCount >= commitThreshold ? 'squash' : 'merge';
    const mergeFlag = mergeStrategy === 'squash' ? '--squash' : '--merge';

    await execAsync(`${ghPath()} pr merge ${prNumber} ${mergeFlag} --delete-branch`, {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    await execAsync(`git checkout ${baseBranch}`, { cwd: workingDirectory });
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
 * Revert all changes in a working directory.
 * Protects .worktrees/ and .agent-pids/ directories from being deleted by git clean.
 *
 * @param workingDirectory - Directory to revert changes in / 変更をリバートするディレクトリ
 * @returns true if revert succeeded / リバート成功時true
 */
export async function revertChanges(workingDirectory: string): Promise<boolean> {
  try {
    await execAsync('git reset HEAD', { cwd: workingDirectory });
    await execAsync('git checkout -- .', { cwd: workingDirectory });
    // NOTE: Use -fd (not -fdx) and explicitly exclude .worktrees/ to prevent deleting active worktrees.
    // Also exclude .agent-pids/ to avoid breaking process tracking.
    await execAsync('git clean -fd -e .worktrees -e .agent-pids', { cwd: workingDirectory });
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Failed to revert changes');
    return false;
  }
}
