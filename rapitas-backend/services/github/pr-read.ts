/**
 * GitHub Pull Request Read Operations
 *
 * Read-only gh CLI operations: list PRs, get a single PR, fetch file diffs,
 * reviews, and comments.
 * Not responsible for writing, approving, or creating PRs.
 */

import { runGhCommand } from './gh-client';
import type {
  PullRequest,
  PullRequestReview,
  PullRequestComment,
  FileDiff,
  GhPullRequest,
  GhFileDiff,
  GhReview,
  GhComment,
} from './types';

/**
 * Get list of pull requests for a repository.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param state - PR state filter / PRの状態フィルター
 * @param limit - Maximum number of results / 最大取得件数
 * @returns Array of pull requests / PRリスト
 */
export async function getPullRequests(
  repo: string,
  state: 'open' | 'closed' | 'all' = 'open',
  limit: number = 30,
): Promise<PullRequest[]> {
  const output = await runGhCommand([
    'pr',
    'list',
    '--repo',
    repo,
    '--state',
    state,
    '--limit',
    String(limit),
    '--json',
    'number,title,body,state,headRefName,baseRefName,author,url,createdAt,updatedAt,additions,deletions,changedFiles',
  ]);

  if (!output) return [];

  const prs = JSON.parse(output);
  return prs.map((pr: GhPullRequest) => ({
    number: pr.number,
    title: pr.title,
    body: pr.body,
    state: pr.state,
    headBranch: pr.headRefName,
    baseBranch: pr.baseRefName,
    authorLogin: pr.author?.login || 'unknown',
    url: pr.url,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
  }));
}

/**
 * Get a single pull request by number.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @returns Pull request or null if not found / PRまたはnull
 */
export async function getPullRequest(repo: string, prNumber: number): Promise<PullRequest | null> {
  try {
    const output = await runGhCommand([
      'pr',
      'view',
      String(prNumber),
      '--repo',
      repo,
      '--json',
      'number,title,body,state,headRefName,baseRefName,author,url,createdAt,updatedAt,mergeable,additions,deletions,changedFiles',
    ]);

    const pr = JSON.parse(output);
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      headBranch: pr.headRefName,
      baseBranch: pr.baseRefName,
      authorLogin: pr.author?.login || 'unknown',
      url: pr.url,
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      mergeable: pr.mergeable,
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changedFiles,
    };
  } catch {
    return null;
  }
}

/**
 * Get the list of changed files for a pull request.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @returns Array of file diffs / ファイル差分リスト
 */
export async function getPullRequestDiff(repo: string, prNumber: number): Promise<FileDiff[]> {
  // NOTE: First call result is unused; kept for potential future jq filtering use
  await runGhCommand([
    'api',
    `repos/${repo}/pulls/${prNumber}/files`,
    '--jq',
    '.[].filename, .[].status, .[].additions, .[].deletions, .[].patch',
  ]);

  const filesOutput = await runGhCommand(['api', `repos/${repo}/pulls/${prNumber}/files`]);
  const files = JSON.parse(filesOutput);
  return files.map((file: GhFileDiff) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
  }));
}

/**
 * Get reviews for a pull request.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @returns Array of reviews / レビューリスト
 */
export async function getPullRequestReviews(
  repo: string,
  prNumber: number,
): Promise<PullRequestReview[]> {
  const output = await runGhCommand(['api', `repos/${repo}/pulls/${prNumber}/reviews`]);
  const reviews = JSON.parse(output);
  return reviews.map((review: GhReview) => ({
    id: review.id,
    state: review.state,
    body: review.body,
    authorLogin: review.user?.login || 'unknown',
    submittedAt: review.submitted_at,
  }));
}

/**
 * Get inline and general comments for a pull request.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param prNumber - PR number / PR番号
 * @returns Array of comments / コメントリスト
 */
export async function getPullRequestComments(
  repo: string,
  prNumber: number,
): Promise<PullRequestComment[]> {
  const output = await runGhCommand(['api', `repos/${repo}/pulls/${prNumber}/comments`]);
  const comments = JSON.parse(output);
  return comments.map((comment: GhComment) => ({
    id: comment.id,
    body: comment.body,
    path: comment.path,
    line: comment.line || comment.original_line,
    authorLogin: comment.user?.login || 'unknown',
    createdAt: comment.created_at,
  }));
}
