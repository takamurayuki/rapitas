/**
 * GitHub Pull Request Write Operations
 *
 * Write-side gh CLI operations: post comments, approve, request changes, create PRs.
 * Not responsible for read operations — those live in pr-read.ts.
 */

import { createLogger } from '../../config/logger';
import { runGhCommand, runGhCommandWithBody } from './gh-client';
import { runGitCommand } from './git-exec';
import type { OwnerRepoString } from './owner-repo';
import type { PullRequestComment, CreatePRCommentInput, GhComment } from './types';

const log = createLogger('github-service:pr-write');

// gh CLI error messages that indicate auto-merge is not configured on the repository.
// These errors are non-recoverable with --auto; falling back to direct merge is safe.
const AUTO_MERGE_UNSUPPORTED_RE =
  /auto.?merge is not allowed|not in a state that can be auto.?merged/i;

// NOTE: Pattern shared with branch-pr-ops.ts — keep in sync if gh CLI changes.
// Branch protection requires "up-to-date" head; detected before the merge lands.
const HEAD_BEHIND_RE =
  /not up.?to.?date with the base branch|not mergeable|base branch was modified/i;

// gh pr update-branch exits non-zero with this message when the head is already
// caught up to base (race condition). Rethrow the original merge error in this case.
const UPDATE_BRANCH_NOOP_RE = /already up.?to.?date|no new commits|not behind/i;

/**
 * Post a comment on a pull request (inline or general).
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @param input - Comment content and optional file/line target / コメント内容
 * @returns Created comment object / 作成されたコメント
 */
export async function createPullRequestComment(
  repo: OwnerRepoString,
  prNumber: number,
  input: CreatePRCommentInput,
): Promise<PullRequestComment> {
  if (input.path && input.line) {
    // Review comment (on a specific file/line)
    const output = await runGhCommand([
      'api',
      `repos/${repo}/pulls/${prNumber}/comments`,
      '-f',
      `body=${input.body}`,
      '-f',
      `path=${input.path}`,
      '-F',
      `line=${input.line}`,
      ...(input.side ? ['-f', `side=${input.side}`] : []),
      ...(input.commitId ? ['-f', `commit_id=${input.commitId}`] : []),
    ]);

    const comment = JSON.parse(output) as GhComment;
    return {
      id: comment.id,
      body: comment.body,
      path: comment.path,
      line: comment.line,
      authorLogin: comment.user?.login || 'unknown',
      createdAt: comment.created_at,
    };
  } else {
    // General comment (Issue comment)
    await runGhCommandWithBody(['pr', 'comment', String(prNumber), '--repo', repo], input.body);

    return {
      id: 0, // gh pr comment does not return an ID
      body: input.body,
      authorLogin: 'rapitas',
      createdAt: new Date().toISOString(),
    };
  }
}

/**
 * Approve a pull request.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @param body - Optional approval message / 承認メッセージ
 */
export async function approvePullRequest(
  repo: OwnerRepoString,
  prNumber: number,
  body?: string,
): Promise<void> {
  const args = ['pr', 'review', String(prNumber), '--repo', repo, '--approve'];
  await runGhCommandWithBody(args, body);
}

/**
 * Request changes on a pull request.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @param body - Change request message / 変更リクエストメッセージ
 */
export async function requestChanges(
  repo: OwnerRepoString,
  prNumber: number,
  body: string,
): Promise<void> {
  await runGhCommandWithBody(
    ['pr', 'review', String(prNumber), '--repo', repo, '--request-changes'],
    body,
  );
}

/**
 * Merge a pull request via `gh pr merge`.
 *
 * When `options.auto` is true, first attempts `--auto` (queued merge that waits
 * for required checks). If the repository does not have auto-merge enabled,
 * gh returns an error; in that case, falls back to a direct merge and logs a
 * warning so operators know to enable "Allow auto-merge" in the repo settings.
 *
 * For direct merges (both explicit and auto fallback): if the head branch is
 * behind base, automatically runs `gh pr update-branch` and retries the merge
 * once. If the retry still fails, throws an actionable message directing the
 * caller to wait for CI to complete before retrying.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number (must be a positive integer) / PR番号（正の整数）
 * @param options - Merge method (default squash), branch deletion, and auto-merge / マージ方式・ブランチ削除・自動マージ
 * @returns Whether the merge was queued via auto-merge or completed immediately / 自動マージキューに入ったか即時マージかを返す
 * @throws {Error} When prNumber is not a positive integer / PR番号が正の整数でない場合
 * @throws {Error} When the merge fails and cannot be recovered by update-branch / マージ失敗かつ回復不能な場合
 * @throws {Error} 'ブランチを最新化しました...' when update-branch succeeded but CI re-run is needed / ブランチ更新後CI待ちが必要な場合
 */
export async function mergePullRequest(
  repo: OwnerRepoString,
  prNumber: number,
  options?: { method?: 'merge' | 'squash' | 'rebase'; deleteBranch?: boolean; auto?: boolean },
): Promise<{ autoQueued: boolean }> {
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    throw new Error(`無効なPR番号です: ${prNumber}`);
  }

  const method = options?.method ?? 'squash';
  const baseArgs = ['pr', 'merge', String(prNumber), '--repo', repo, `--${method}`];
  if (options?.deleteBranch) baseArgs.push('--delete-branch');

  /**
   * Run a direct gh pr merge, with one automatic recovery attempt when the head
   * branch is behind the base. Uses runGhCommand throughout for consistent
   * logging, encoding, and windowsHide behaviour.
   */
  async function runDirectMerge(mergeArgs: string[]): Promise<void> {
    try {
      await runGhCommand(mergeArgs);
    } catch (mergeErr) {
      const mergeMsg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);

      if (!HEAD_BEHIND_RE.test(mergeMsg)) {
        throw mergeErr;
      }

      // Head is behind base — bring it up to date on GitHub.
      // NOTE: skipLog suppresses the ERROR emitted by runGhCommand when
      // update-branch exits non-zero (e.g. "already up to date" race).
      try {
        await runGhCommand(['pr', 'update-branch', String(prNumber), '--repo', repo], undefined, {
          skipLog: true,
        });
      } catch (updateErr) {
        const updateMsg = updateErr instanceof Error ? updateErr.message : String(updateErr);
        if (UPDATE_BRANCH_NOOP_RE.test(updateMsg)) {
          // Branch was already up to date — rethrow original merge error.
          throw mergeErr;
        }
        throw updateErr;
      }

      // Retry merge once after the branch has been updated.
      try {
        await runGhCommand(mergeArgs);
      } catch {
        throw new Error('ブランチを最新化しました。CI 完了後に再度マージしてください');
      }
    }
  }

  if (!options?.auto) {
    await runDirectMerge(baseArgs);
    return { autoQueued: false };
  }

  // --auto queues the merge so GitHub completes it once required checks pass.
  try {
    // NOTE: skipLog suppresses the ERROR that runGhCommand would emit on failure;
    // the catch block below logs at warn level when the failure is expected.
    await runGhCommand([...baseArgs, '--auto'], undefined, { skipLog: true });
    return { autoQueued: true };
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);

    if (!AUTO_MERGE_UNSUPPORTED_RE.test(errMessage)) {
      // Unrelated failure (conflict, branch protection, auth, etc.) — propagate.
      throw err;
    }

    // NOTE: --auto requires "Allow auto-merge" enabled in GitHub repository
    // settings plus branch protection rules with required status checks.
    // Retrying as a direct merge because this repository is not configured for it.
    log.warn(
      { repo, prNumber, ghError: errMessage },
      'gh --auto failed: auto-merge not enabled on repository; retrying as direct merge',
    );
    await runDirectMerge(baseArgs);
    return { autoQueued: false };
  }
}

/**
 * Change a pull request's base (merge target) branch via `gh pr edit`.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @param baseBranch - New base (merge target) branch / 新しいマージ先ブランチ
 */
export async function changePullRequestBase(
  repo: OwnerRepoString,
  prNumber: number,
  baseBranch: string,
): Promise<void> {
  await runGhCommand(['pr', 'edit', String(prNumber), '--repo', repo, '--base', baseBranch]);
}

/**
 * Sync a local branch with its remote after a merge, so the merged changes are
 * reflected locally. Fast-forwards when the branch is checked out; otherwise
 * updates the local ref to match the remote. Best-effort: never throws — returns
 * a result describing what happened so the caller can surface it.
 *
 * @param workingDirectory - Local git repository path / ローカルgitリポジトリパス
 * @param branch - Branch to sync (the PR's base branch) / 同期するブランチ
 * @returns Whether the sync succeeded and a human-readable detail / 同期結果と詳細
 */
export async function syncLocalBranchWithRemote(
  workingDirectory: string,
  branch: string,
): Promise<{ synced: boolean; detail: string }> {
  try {
    await runGitCommand(['fetch', 'origin', branch], workingDirectory);

    const current = await runGitCommand(['branch', '--show-current'], workingDirectory);

    if (current === branch) {
      // The base branch is checked out — fast-forward it to the remote.
      try {
        await runGitCommand(['merge', '--ff-only', `origin/${branch}`], workingDirectory);
        return { synced: true, detail: `ローカルの ${branch} を origin/${branch} に更新しました` };
      } catch {
        // Diverged: local ${branch} has commit(s) not on origin, so a fast-forward
        // is impossible (the "Not possible to fast-forward" error the user hit).
        // Reconcile ONLY when the working tree is clean, and via a NON-ff merge so
        // no local commit is lost. A dirty tree, or a conflicting merge, is left
        // untouched and reported — never force-reset (that destroyed developer work
        // in the main-checkout-clobber incident).
        const status = await runGitCommand(['status', '--porcelain'], workingDirectory).catch(
          () => 'dirty',
        );
        if (status.trim()) {
          return {
            synced: false,
            detail: `ローカルの ${branch} が origin/${branch} と分岐し、未コミットの変更があるため同期をスキップしました（手動で reconcile してください）`,
          };
        }
        try {
          await runGitCommand(
            ['merge', '--no-ff', '--no-edit', `origin/${branch}`],
            workingDirectory,
          );
          return {
            synced: true,
            detail: `ローカルの ${branch} を origin/${branch} とマージしました（分岐をマージコミットで解消）`,
          };
        } catch {
          await runGitCommand(['merge', '--abort'], workingDirectory).catch(() => {});
          return {
            synced: false,
            detail: `ローカルの ${branch} が origin/${branch} と競合し自動マージできませんでした（手動 reconcile が必要）`,
          };
        }
      }
    }

    // Not checked out — move the local ref to the fetched remote tip. Fails if
    // the branch doesn't exist locally yet, which is fine (nothing to sync).
    await runGitCommand(['fetch', 'origin', `${branch}:${branch}`], workingDirectory);
    return { synced: true, detail: `ローカルの ${branch} を origin/${branch} に更新しました` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ workingDirectory, branch, message }, 'Failed to sync local branch after merge');
    return { synced: false, detail: message };
  }
}

/**
 * Create a pull request from the given working directory.
 *
 * @param workingDirectory - Path to the git repository / gitリポジトリパス
 * @param headBranch - Source branch name / ソースブランチ名
 * @param baseBranch - Target branch name / マージ先ブランチ名
 * @param title - PR title / PRタイトル
 * @param body - PR description / PR本文
 * @returns Result with prNumber, prUrl, and success flag / 作成結果
 */
export async function createPullRequest(
  workingDirectory: string,
  headBranch: string,
  baseBranch: string,
  title: string,
  body: string,
): Promise<{ prNumber?: number; prUrl?: string; success: boolean; error?: string }> {
  try {
    // Push the current branch
    await runGitCommand(['push', '-u', 'origin', headBranch], workingDirectory);

    const output = await runGhCommandWithBody(
      ['pr', 'create', '--title', title, '--base', baseBranch, '--head', headBranch],
      body,
      workingDirectory,
    );

    const prUrl = output.trim();
    const prMatch = prUrl.match(/\/pull\/(\d+)/);
    const prNumber = prMatch ? parseInt(prMatch[1], 10) : undefined;

    return { success: true, prUrl, prNumber };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, 'Failed to create PR');
    return { success: false, error: message };
  }
}
