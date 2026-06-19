/**
 * GitOperations — Branch and Pull Request Operations
 *
 * Manages branches, pull requests, merges, and reverts.
 * Not responsible for low-level diff/commit operations or worktree management.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../../../config/logger';
import { isPrimaryWorkTree, ensureNotPrimaryWorkTree } from './worktree-guard';

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
    // Switching/creating a branch on the primary checkout changes the
    // developer's current branch — only do it inside a worktree.
    await ensureNotPrimaryWorkTree(workingDirectory, `switch to branch ${branchName}`);
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

/** Matches git's various "remote is ahead / you must fetch first" push errors. */
function isNonFastForwardError(message: string): boolean {
  return /non-fast-forward|\[rejected\]|fetch first|tip of your current branch is behind|Updates were rejected/i.test(
    message,
  );
}

/**
 * Push the current branch for PR creation, tolerant of a DIVERGED remote branch.
 *
 * A plain `git push -u origin <branch>` fails non-fast-forward when origin already
 * has a branch of the same name from an earlier run (common because the branch
 * namer collapses many tasks to `feature/implement-task`). Rather than
 * force-pushing — which could rewrite a still-open PR or merged history — this
 * renames the local branch to a commit-unique name and pushes that, so a PR can
 * always be created without clobbering anything.
 *
 * @param cwd - Repository / worktree directory / リポジトリ・worktree ディレクトリ
 * @param branch - The branch the agent worked on / エージェントの作業ブランチ
 * @returns The branch name actually pushed (renamed on divergence) / 実際に push したブランチ名
 * @throws Re-throws non-divergence push failures (auth, network, etc.). / 分岐以外の push 失敗は再送出。
 */
async function pushBranchForPr(cwd: string, branch: string): Promise<string> {
  try {
    await execAsync(`git push -u origin ${branch}`, { cwd });
    return branch;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!isNonFastForwardError(msg)) throw error;

    const { stdout: sha } = await execAsync('git rev-parse --short HEAD', { cwd });
    const unique = `${branch}-${sha.trim()}`;
    logger.warn(
      `[createPullRequest] origin/${branch} has diverged; pushing unique branch ${unique} instead`,
    );
    // Rename the local branch so HEAD (and gh's inferred PR head) match the push.
    await execAsync(`git branch -M ${unique}`, { cwd });
    try {
      await execAsync(`git push -u origin ${unique}`, { cwd });
    } catch (err2) {
      const msg2 = err2 instanceof Error ? err2.message : String(err2);
      if (!isNonFastForwardError(msg2)) throw err2;
      // The commit-unique branch also diverged — it is tied to THIS exact commit,
      // so a lease-guarded force can only restore identical work.
      await execAsync(`git push -u --force-with-lease origin ${unique}`, { cwd });
    }
    return unique;
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
      // Prefer develop, then main, then master. Check the REMOTE-tracking ref
      // (origin/<b>) as well as a local branch: `gh pr create --base` targets the
      // remote, and in many checkouts `develop` exists ONLY as `origin/develop`
      // (no local branch). The old local-only check then fell through to main —
      // the recurring #170/#172 mistarget where the PR diff shows main instead of
      // develop until manually retargeted.
      const branchExists = async (b: string): Promise<boolean> => {
        const local = await execAsync(`git branch --list ${b}`, {
          cwd: workingDirectory,
          encoding: 'utf8',
        })
          .then((r) => !!r.stdout.trim())
          .catch(() => false);
        if (local) return true;
        return await execAsync(`git branch -r --list origin/${b}`, {
          cwd: workingDirectory,
          encoding: 'utf8',
        })
          .then((r) => !!r.stdout.trim())
          .catch(() => false);
      };
      if (await branchExists('develop')) targetBranch = 'develop';
      else if (await branchExists('main')) targetBranch = 'main';
      else targetBranch = 'master';
      logger.info(`[createPullRequest] Auto-determined base branch: ${targetBranch}`);
    }

    const { stdout: currentBranchRaw } = await execAsync('git branch --show-current', {
      cwd: workingDirectory,
      encoding: 'utf8',
    });

    // Push the work. If origin's branch has DIVERGED (a stale branch left by a
    // prior run — the AI/fallback namer collapses many Japanese-titled tasks to
    // the shared `feature/implement-task`, so collisions are common), this falls
    // back to a fresh uniquely-named branch instead of failing the whole PR step.
    const currentBranch = await pushBranchForPr(workingDirectory, currentBranchRaw.trim());

    // Idempotent: a CI-repair re-run pushes a fix to the SAME branch. The push
    // above already updated any existing PR, so reuse it instead of letting
    // `gh pr create` fail with "a pull request already exists".
    try {
      const { stdout: existing } = await execAsync(
        `${ghPath()} pr list --head ${currentBranch} --state open --json number,url,baseRefName --jq ".[0]"`,
        { cwd: workingDirectory, encoding: 'utf8' },
      );
      const trimmed = existing.trim();
      if (trimmed && trimmed !== 'null') {
        const pr = JSON.parse(trimmed) as { number?: number; url?: string; baseRefName?: string };
        if (pr.number && pr.url) {
          // A reused PR may have been opened against the WRONG base by an earlier
          // run (e.g. main instead of the theme's develop — the recurring #170/#172
          // mistarget). Retarget to the intended base so completion lands on the
          // right branch. Best-effort: a retarget failure still reuses the PR.
          if (pr.baseRefName && pr.baseRefName !== targetBranch) {
            try {
              await execAsync(`${ghPath()} pr edit ${pr.number} --base ${targetBranch}`, {
                cwd: workingDirectory,
                encoding: 'utf8',
              });
              logger.info(
                `[createPullRequest] Retargeted reused PR #${pr.number} base ${pr.baseRefName} -> ${targetBranch}`,
              );
            } catch (err) {
              logger.warn(
                { err, prNumber: pr.number },
                `[createPullRequest] Failed to retarget PR #${pr.number} base to ${targetBranch}`,
              );
            }
          }
          logger.info(`[createPullRequest] Reusing existing PR #${pr.number} for ${currentBranch}`);
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

    // Post-merge local sync. On the PRIMARY checkout this `git checkout` + pull
    // would switch the developer's branch and could clobber uncommitted work —
    // skip it there (the merge already landed on GitHub). Only sync worktrees.
    if (await isPrimaryWorkTree(workingDirectory)) {
      logger.warn(
        { workingDirectory },
        '[mergeBranch] primary working tree — skipping local checkout+pull sync to protect developer work',
      );
    } else {
      await execAsync(`git checkout ${baseBranch}`, { cwd: workingDirectory });
      await execAsync('git pull', { cwd: workingDirectory });
    }

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
