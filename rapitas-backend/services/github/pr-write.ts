/**
 * GitHub Pull Request Write Operations
 *
 * Write-side gh CLI operations: post comments, approve, request changes, create PRs.
 * Not responsible for read operations — those live in pr-read.ts.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../../config/logger';
import { runGhCommand } from './gh-client';
import type { PullRequestComment, CreatePRCommentInput, GhComment } from './types';

const log = createLogger('github-service:pr-write');
const execAsync = promisify(exec);

/**
 * Post a comment on a pull request (inline or general).
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @param input - Comment content and optional file/line target / コメント内容
 * @returns Created comment object / 作成されたコメント
 */
export async function createPullRequestComment(
  repo: string,
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
    await runGhCommand(['pr', 'comment', String(prNumber), '--repo', repo, '--body', input.body]);

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
  repo: string,
  prNumber: number,
  body?: string,
): Promise<void> {
  const args = ['pr', 'review', String(prNumber), '--repo', repo, '--approve'];
  if (body) args.push('--body', body);
  await runGhCommand(args);
}

/**
 * Request changes on a pull request.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @param body - Change request message / 変更リクエストメッセージ
 */
export async function requestChanges(repo: string, prNumber: number, body: string): Promise<void> {
  await runGhCommand([
    'pr',
    'review',
    String(prNumber),
    '--repo',
    repo,
    '--request-changes',
    '--body',
    body,
  ]);
}

/**
 * Merge a pull request via `gh pr merge`.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @param options - Merge method (default squash), branch deletion, and auto-merge / マージ方式・ブランチ削除・自動マージ
 */
export async function mergePullRequest(
  repo: string,
  prNumber: number,
  options?: { method?: 'merge' | 'squash' | 'rebase'; deleteBranch?: boolean; auto?: boolean },
): Promise<void> {
  const method = options?.method ?? 'squash';
  const args = ['pr', 'merge', String(prNumber), '--repo', repo, `--${method}`];
  if (options?.deleteBranch) args.push('--delete-branch');
  // --auto queues the merge so GitHub completes it once requirements are met
  // (pending checks, etc.). It does NOT resolve a true merge conflict.
  if (options?.auto) args.push('--auto');
  await runGhCommand(args);
}

/**
 * Change a pull request's base (merge target) branch via `gh pr edit`.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @param baseBranch - New base (merge target) branch / 新しいマージ先ブランチ
 */
export async function changePullRequestBase(
  repo: string,
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
    await execAsync(`git fetch origin ${branch}`, { cwd: workingDirectory });

    const { stdout: cur } = await execAsync('git branch --show-current', {
      cwd: workingDirectory,
    });
    const current = cur.trim();

    if (current === branch) {
      // The base branch is checked out — fast-forward it to the remote.
      await execAsync(`git merge --ff-only origin/${branch}`, { cwd: workingDirectory });
      return { synced: true, detail: `ローカルの ${branch} を origin/${branch} に更新しました` };
    }

    // Not checked out — move the local ref to the fetched remote tip. Fails if
    // the branch doesn't exist locally yet, which is fine (nothing to sync).
    await execAsync(`git fetch origin ${branch}:${branch}`, { cwd: workingDirectory });
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
    await execAsync(`git push -u origin ${headBranch}`, { cwd: workingDirectory });

    const output = await runGhCommand(
      [
        'pr',
        'create',
        '--title',
        title,
        '--body',
        body,
        '--base',
        baseBranch,
        '--head',
        headBranch,
      ],
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
