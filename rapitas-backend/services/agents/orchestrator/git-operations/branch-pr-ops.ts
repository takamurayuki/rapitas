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
export async function createBranch(workingDirectory: string, branchName: string): Promise<boolean> {
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

    // Idempotent: a CI-repair re-run pushes a fix to the SAME branch. The push
    // above already updated any existing PR, so reuse it instead of letting
    // `gh pr create` fail with "a pull request already exists".
    try {
      const { stdout: existing } = await execAsync(
        `${ghPath()} pr list --head ${currentBranch.trim()} --state open --json number,url --jq ".[0]"`,
        { cwd: workingDirectory, encoding: 'utf8' },
      );
      const trimmed = existing.trim();
      if (trimmed && trimmed !== 'null') {
        const pr = JSON.parse(trimmed) as { number?: number; url?: string };
        if (pr.number && pr.url) {
          logger.info(
            `[createPullRequest] Reusing existing PR #${pr.number} for ${currentBranch.trim()}`,
          );
          return { success: true, prUrl: pr.url, prNumber: pr.number };
        }
      }
    } catch {
      // No existing PR (or gh error) — fall through to create.
    }

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
  /**
   * The merge was blocked by a transient/recoverable condition (head branch
   * behind base — branch protection requires up-to-date). We updated the branch;
   * the caller should retry on a later poll (CI re-runs first). Not a failure.
   */
  retriable?: boolean;
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
    const msg = error instanceof Error ? error.message : String(error);
    // Branch protection requires the head branch to be up to date with base.
    // Update it (merge base into the PR head on GitHub) so CI re-runs; the
    // caller (AutoMergeWatcher) retries the merge once checks are green again.
    if (/not up.?to.?date with the base branch|not mergeable|base branch was modified/i.test(msg)) {
      try {
        await execAsync(`${ghPath()} pr update-branch ${prNumber}`, {
          cwd: workingDirectory,
          encoding: 'utf8',
        });
        return {
          success: false,
          retriable: true,
          error: 'head branch was behind base; updated branch — will retry after CI re-runs',
        };
      } catch (updErr) {
        const um = updErr instanceof Error ? updErr.message : String(updErr);
        // Already up to date (race) — just retry the merge next tick.
        if (/already up.?to.?date|no new commits|not behind/i.test(um)) {
          return {
            success: false,
            retriable: true,
            error: 'branch already up to date; will retry',
          };
        }
        return { success: false, error: `update-branch failed: ${um}` };
      }
    }
    return { success: false, error: msg };
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
    // SAFETY GATE: `git checkout -- .` + `git clean -fd` are DESTRUCTIVE — they
    // discard ALL uncommitted changes and delete ALL untracked files in the
    // target. That is only acceptable inside a DEDICATED agent worktree. If this
    // ever runs on the PRIMARY working tree (e.g. rapitas self-development where
    // the theme's workingDirectory is the main checkout), it wipes the
    // developer's own in-progress work. This actually happened: a stop reverted
    // the main checkout and destroyed a whole session of uncommitted edits.
    //
    // A linked worktree has git-dir (`.git/worktrees/<name>`) != git-common-dir
    // (the shared `.git`); the PRIMARY worktree has them equal. Refuse to revert
    // the primary worktree.
    if (await isPrimaryWorkTree(workingDirectory)) {
      logger.warn(
        { workingDirectory },
        '[revertChanges] Refusing to hard-revert the PRIMARY working tree — this would destroy uncommitted developer work. Agent changes (if any) are left in place; isolate agent runs in a worktree instead.',
      );
      return false;
    }

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

/**
 * Determine whether a directory is the PRIMARY git working tree (as opposed to
 * a linked `git worktree`). Returns true on the primary tree, where destructive
 * reverts would clobber the developer's own work.
 *
 * @param workingDirectory - Directory to test / 判定対象ディレクトリ
 * @returns true if primary worktree (or detection failed → treat as primary to be safe) / プライマリなら true（判定失敗時も安全側で true）
 */
async function isPrimaryWorkTree(workingDirectory: string): Promise<boolean> {
  try {
    const [gitDir, commonDir] = await Promise.all([
      execAsync('git rev-parse --absolute-git-dir', { cwd: workingDirectory }),
      execAsync('git rev-parse --git-common-dir', { cwd: workingDirectory }),
    ]);
    const normalize = (p: string) => p.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    let common = normalize(commonDir.stdout);
    // --git-common-dir may be relative (e.g. ".git"); resolve against the dir.
    if (!/^([a-zA-Z]:)?\//.test(common)) {
      const root = await execAsync('git rev-parse --show-toplevel', { cwd: workingDirectory });
      common = normalize(`${normalize(root.stdout)}/${common}`);
    }
    return normalize(gitDir.stdout) === common;
  } catch (error) {
    // If we cannot tell, assume PRIMARY and refuse — never risk the main tree.
    logger.warn(
      { err: error, workingDirectory },
      '[revertChanges] Could not determine worktree type; treating as primary and skipping revert',
    );
    return true;
  }
}
