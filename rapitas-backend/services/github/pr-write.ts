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
      'api', `repos/${repo}/pulls/${prNumber}/comments`,
      '-f', `body=${input.body}`,
      '-f', `path=${input.path}`,
      '-F', `line=${input.line}`,
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
    'pr', 'review', String(prNumber), '--repo', repo,
    '--request-changes', '--body', body,
  ]);
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
      ['pr', 'create', '--title', title, '--body', body, '--base', baseBranch, '--head', headBranch],
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
