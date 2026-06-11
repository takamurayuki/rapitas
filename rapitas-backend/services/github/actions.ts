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

/** A step's log section sliced out of a job's `gh run view --log` output. */
export interface JobLogSection {
  /** Step number, matching the step's `number` from the run detail. / ステップ番号 */
  number: number;
  /** Step name. / ステップ名 */
  name: string;
  /** That step's concatenated log lines (timestamps stripped). / ステップのログ */
  log: string;
}

/** Minimal step timing pulled from the REST job endpoint, used for bucketing. */
interface StepTiming {
  number: number;
  name: string;
  /** ISO start time, or null if the step never started. / 開始時刻 */
  startedAt: string | null;
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

/**
 * Slice raw `gh run view --log` lines into per-step sections by timestamp.
 *
 * gh's own step column is unreliable (it is frequently "UNKNOWN STEP"), so we
 * instead assign each log line to the last step whose `startedAt` is at or
 * before the line's ISO timestamp. Steps are returned in execution order; the
 * leading timestamp — and the UTF-8 BOM gh prepends to the first line — are
 * stripped from each line for display.
 *
 * @param raw - Raw `gh ... --log` stdout / gh のログ出力
 * @param steps - Step timings from the REST job endpoint / ステップの時刻情報
 * @returns Per-step log sections in execution order / 実行順のステップ別ログ
 */
function bucketLogByStep(raw: string, steps: StepTiming[]): JobLogSection[] {
  const timed = steps
    .filter((s) => s.startedAt)
    .map((s) => ({ number: s.number, start: Date.parse(s.startedAt as string) }))
    .sort((a, b) => a.start - b.start);

  const logs = new Map<number, string[]>();
  for (const s of steps) logs.set(s.number, []);

  // The step a line at `ts` belongs to: the last step started at or before it.
  const stepFor = (ts: number): number => {
    let chosen = timed[0]?.number ?? steps[0]?.number ?? 0;
    for (const s of timed) {
      if (s.start <= ts) chosen = s.number;
      else break;
    }
    return chosen;
  };

  for (const line of raw.split('\n')) {
    if (!line) continue;
    const parts = line.split('\t');
    let content = parts.length >= 3 ? parts.slice(2).join('\t') : line;
    content = content.replace(/^﻿/, ''); // gh prepends a BOM to the first line
    const tsMatch = content.match(/^(\S+Z)\s?/);
    const display = tsMatch ? content.slice(tsMatch[0].length) : content;
    const ts = tsMatch ? Date.parse(tsMatch[1]) : Number.NEGATIVE_INFINITY;
    const target = timed.length ? stepFor(ts) : (steps[0]?.number ?? 0);
    const bucket = logs.get(target);
    if (bucket) bucket.push(display);
    else logs.set(target, [display]);
  }

  // No step metadata — return the whole log as one section so it is still shown.
  if (steps.length === 0) {
    return [{ number: 0, name: 'ログ', log: (logs.get(0) ?? []).join('\n') }];
  }
  return steps.map((s) => ({
    number: s.number,
    name: s.name,
    log: (logs.get(s.number) ?? []).join('\n'),
  }));
}

/**
 * Fetch a single job's log, sliced into per-step sections.
 * Best-effort: gh errors (expired logs, etc.) come back as a single section.
 *
 * @param repo - Repository in owner/name format / リポジトリ名
 * @param jobId - The job's databaseId / ジョブID
 * @returns Per-step log sections / ステップ単位のログセクション
 */
export async function getWorkflowJobLog(repo: string, jobId: number): Promise<JobLogSection[]> {
  // Step timings drive the bucketing; gh's --log step column can't be trusted.
  let steps: StepTiming[] = [];
  try {
    const json = await runGhCommand([
      'api',
      `repos/${repo}/actions/jobs/${jobId}`,
      '--jq',
      '.steps',
    ]);
    if (json) {
      const parsed = JSON.parse(json) as Array<{
        number: number;
        name: string;
        started_at: string | null;
      }>;
      steps = parsed.map((s) => ({ number: s.number, name: s.name, startedAt: s.started_at }));
    }
  } catch {
    /* step timings unavailable — bucketLogByStep returns a single section */
  }

  let raw: string;
  try {
    raw = await runGhCommand(['run', 'view', '--repo', repo, '--log', '--job', String(jobId)]);
  } catch (err) {
    return [
      { number: 0, name: 'ログ取得エラー', log: err instanceof Error ? err.message : String(err) },
    ];
  }
  return bucketLogByStep(raw, steps);
}
