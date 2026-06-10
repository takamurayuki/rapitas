/**
 * GitHub Actions (CI/CD)
 *
 * Read-only CI/CD operations via the gh CLI: list a repo's workflow runs,
 * fetch a run's jobs/steps, and fetch a run's logs. Not responsible for
 * triggering or cancelling workflows.
 */

import { runGhCommand } from './gh-client';

/** A single Actions workflow run (list view). */
export interface WorkflowRunSummary {
  databaseId: number;
  number: number;
  displayTitle: string;
  /** queued | in_progress | completed */
  status: string;
  /** success | failure | cancelled | skipped | null (while running) */
  conclusion: string | null;
  workflowName: string;
  headBranch: string;
  event: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}

/** A step within a run's job. */
export interface WorkflowRunStep {
  name: string;
  number: number;
  status: string;
  conclusion: string | null;
}

/** A job within a run. */
export interface WorkflowRunJob {
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string;
  completedAt: string;
  steps: WorkflowRunStep[];
}

/** A run with its jobs/steps (detail view). */
export interface WorkflowRunDetail extends WorkflowRunSummary {
  jobs: WorkflowRunJob[];
}

const RUN_LIST_FIELDS =
  'databaseId,number,displayTitle,status,conclusion,workflowName,headBranch,event,createdAt,updatedAt,url';

/**
 * List the most recent workflow runs for a repository.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param limit - Max runs to return (default 20) / 取得件数
 * @returns Workflow run summaries (newest first) / 実行サマリ一覧
 */
export async function listWorkflowRuns(repo: string, limit = 20): Promise<WorkflowRunSummary[]> {
  const out = await runGhCommand([
    'run',
    'list',
    '--repo',
    repo,
    '--limit',
    String(limit),
    '--json',
    RUN_LIST_FIELDS,
  ]);
  if (!out) return [];
  return JSON.parse(out) as WorkflowRunSummary[];
}

/**
 * Fetch a single run with its jobs and steps.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param runId - The run's databaseId / 実行ID
 * @returns The run detail, or null if not found / 実行詳細、無ければnull
 */
export async function getWorkflowRun(
  repo: string,
  runId: number,
): Promise<WorkflowRunDetail | null> {
  const out = await runGhCommand([
    'run',
    'view',
    String(runId),
    '--repo',
    repo,
    '--json',
    `${RUN_LIST_FIELDS},jobs`,
  ]);
  if (!out) return null;
  return JSON.parse(out) as WorkflowRunDetail;
}

/**
 * Fetch a run's logs. `onlyFailed` returns just the failed steps' output (much
 * smaller, the usual case for debugging). Best-effort: gh errors (e.g.
 * --log-failed on a successful run, or expired logs) are returned as text.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param runId - The run's databaseId / 実行ID
 * @param onlyFailed - Only failed steps' logs / 失敗ステップのログのみ
 * @returns Raw log text (or an error message) / ログ文字列（またはエラーメッセージ）
 */
export async function getWorkflowRunLog(
  repo: string,
  runId: number,
  onlyFailed: boolean,
): Promise<string> {
  try {
    return await runGhCommand([
      'run',
      'view',
      String(runId),
      '--repo',
      repo,
      onlyFailed ? '--log-failed' : '--log',
    ]);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
