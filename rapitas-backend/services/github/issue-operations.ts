/**
 * GitHub Issue Operations
 *
 * All issue read, create, and comment operations via gh CLI.
 * Not responsible for pull request operations, sync, or webhook handling.
 */

import { createLogger } from '../../config/logger';
import { runGhCommand } from './gh-client';
import type { Issue, CreateIssueInput, GhIssue, GhLabel } from './types';

const log = createLogger('github-service:issues');

/**
 * Get list of issues for a repository.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param state - Issue state filter / イシューの状態フィルター
 * @param limit - Maximum number of results / 最大取得件数
 * @returns Array of issues / イシューリスト
 */
export async function getIssues(
  repo: string,
  state: 'open' | 'closed' | 'all' = 'open',
  limit: number = 30,
): Promise<Issue[]> {
  const output = await runGhCommand([
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    state,
    '--limit',
    String(limit),
    '--json',
    'number,title,body,state,labels,author,url,createdAt,updatedAt',
  ]);

  if (!output) return [];

  const issues = JSON.parse(output);
  return issues.map((issue: GhIssue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: issue.labels?.map((l: GhLabel) => l.name) || [],
    authorLogin: issue.author?.login || 'unknown',
    url: issue.url,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  }));
}

/**
 * Get a single issue by number.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param issueNumber - Issue number / イシュー番号
 * @returns Issue or null if not found / イシューまたはnull
 */
export async function getIssue(repo: string, issueNumber: number): Promise<Issue | null> {
  try {
    const output = await runGhCommand([
      'issue',
      'view',
      String(issueNumber),
      '--repo',
      repo,
      '--json',
      'number,title,body,state,labels,author,url,createdAt,updatedAt',
    ]);

    const issue = JSON.parse(output);
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      labels: issue.labels?.map((l: GhLabel) => l.name) || [],
      authorLogin: issue.author?.login || 'unknown',
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Create a new issue in a repository.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param input - Issue creation input / イシュー作成入力
 * @returns Created issue / 作成されたイシュー
 * @throws {Error} When issue URL cannot be parsed or issue cannot be fetched
 */
/**
 * Ensure each label exists in the repo, creating any that are missing. Failures
 * (including "label already exists") are ignored — best-effort so a label that
 * already exists doesn't block issue creation.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param labels - Label names to ensure / 作成を保証するラベル名
 */
async function ensureLabelsExist(repo: string, labels: string[]): Promise<void> {
  for (const label of labels) {
    try {
      await runGhCommand(['label', 'create', label, '--repo', repo]);
    } catch {
      // Already exists, or can't be created — the issue create will still
      // attach it if present. Non-fatal.
    }
  }
}

export async function createIssue(repo: string, input: CreateIssueInput): Promise<Issue> {
  const args = ['issue', 'create', '--repo', repo, '--title', input.title];

  if (input.body) {
    args.push('--body', input.body);
  }
  if (input.labels && input.labels.length > 0) {
    // `gh issue create --label` fails if a label doesn't exist in the repo
    // (e.g. our `type:*` / `priority:*` labels on a fresh repo), so ensure they
    // exist first. Idempotent: creating an existing label is ignored.
    await ensureLabelsExist(repo, input.labels);
    args.push('--label', input.labels.join(','));
  }
  if (input.assignees && input.assignees.length > 0) {
    args.push('--assignee', input.assignees.join(','));
  }

  // Get the URL
  const url = await runGhCommand(args);

  // Extract the created issue number
  const match = url.match(/\/issues\/(\d+)/);
  if (!match) {
    throw new Error('Failed to parse created issue URL');
  }

  const issueNumber = parseInt(match[1], 10);
  const issue = await getIssue(repo, issueNumber);
  if (!issue) {
    throw new Error('Failed to fetch created issue');
  }

  return issue;
}

/**
 * Close an issue on GitHub.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param issueNumber - Issue number / イシュー番号
 * @throws {Error} When the gh command fails / コマンド失敗時
 */
export async function closeIssue(repo: string, issueNumber: number): Promise<void> {
  await runGhCommand(['issue', 'close', String(issueNumber), '--repo', repo]);
  log.info({ repo, issueNumber }, 'Issue closed');
}

/**
 * Add a comment to an issue.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param issueNumber - Issue number / イシュー番号
 * @param body - Comment text / コメント本文
 * @returns Created comment stub (gh does not return an ID) / 作成されたコメントのスタブ
 */
export async function addIssueComment(
  repo: string,
  issueNumber: number,
  body: string,
): Promise<{ id: number; body: string }> {
  await runGhCommand(['issue', 'comment', String(issueNumber), '--repo', repo, '--body', body]);

  return {
    id: 0, // gh issue comment does not return an ID
    body,
  };
}
