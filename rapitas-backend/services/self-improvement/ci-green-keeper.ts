/**
 * CI Green Keeper
 *
 * 本線の最新CI失敗を、失敗ジョブ・ステップ名付きの懸念として起票する。
 * 通常ジョブはテーマ＋workflow、advisoryはテーマ＋workflow＋jobで重複を防ぐ。
 * Advisory (continue-on-error) jobs leave the workflow green, so for workflows
 * listed in ADVISORY_JOBS the run's jobs are read too and a red advisory job
 * is filed per theme+workflow+job (see ci-green-keeper-jobs.ts).
 * Not responsible for fixing anything — the concern→task pipeline is the
 * repair path. Scheduling lives in backlog-scheduler.ts (kind 'ci_watch').
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'fs';
import { join } from 'path';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { submitConcern } from '../memory/concern-backlog-service';
import { getDisabledThemeIds } from '../scheduling/theme-backlog-override-service';
import {
  ADVISORY_JOBS,
  buildJobConcernBody,
  extractFailedTestNames,
  jobDedupKey,
  pickAdvisoryFailures,
  pickLatestCompletedRuns,
  type CiJob,
} from './ci-green-keeper-jobs';

const execAsync = promisify(exec);
const log = createLogger('self-improvement:ci-green-keeper');

/** Max themes checked per run — bounds gh API cost. */
const MAX_THEMES = 5;
/** Recent runs fetched per repo (enough to cover every workflow's latest). */
const RUNS_FETCHED = 20;

function ghPath(): string {
  return process.platform === 'win32' ? '"C:\\Program Files\\GitHub CLI\\gh.exe"' : 'gh';
}

/** One workflow run as returned by `gh run list`. */
export interface CiRun {
  databaseId: number;
  workflowName: string;
  status: string;
  conclusion: string | null;
}

/**
 * Pick each workflow's LATEST completed run from a newest-first run list and
 * return the failing ones. Pure — the testable core.
 *
 * @param runs - Runs, newest first (gh run list order). / 新しい順のrun一覧
 * @returns Failing latest-per-workflow runs. / ワークフロー毎の最新失敗run
 */
export function pickFailingWorkflows(runs: CiRun[]): CiRun[] {
  const seen = new Set<string>();
  const failing: CiRun[] = [];
  for (const run of runs) {
    if (run.status !== 'completed') continue; // in-progress → judge next time
    if (seen.has(run.workflowName)) continue; // only the newest per workflow
    seen.add(run.workflowName);
    if (run.conclusion === 'failure' || run.conclusion === 'timed_out') failing.push(run);
  }
  return failing;
}

/** Fetch recent runs for a repo's branch, or null when gh/repo is unusable. */
async function listRecentRuns(cwd: string, branch: string): Promise<CiRun[] | null> {
  try {
    const { stdout } = await execAsync(
      `${ghPath()} run list --branch ${branch} --limit ${RUNS_FETCHED} --json databaseId,workflowName,status,conclusion`,
      { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const parsed: unknown = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed as CiRun[]) : null;
  } catch (err) {
    // No gh / no remote / no Actions — this repo simply isn't watchable.
    log.debug({ err, cwd, branch }, '[ci-green-keeper] run list unavailable');
    return null;
  }
}

/** Jobs + run URL of one run, as returned by `gh run view --json jobs,url`. */
export interface CiRunView {
  url?: string;
  jobs: CiJob[];
}

/** gh access, injectable so the watch pass can be tested without a real gh. */
export interface CiWatchDeps {
  listRuns(cwd: string, branch: string): Promise<CiRun[] | null>;
  viewJobs(cwd: string, runId: number): Promise<CiRunView | null>;
  logFailed(cwd: string, runId: number): Promise<string | null>;
}

/** Guard: run ids are interpolated into a shell command line. */
function safeRunId(runId: number): boolean {
  return Number.isSafeInteger(runId) && runId > 0;
}

async function viewJobsViaGh(cwd: string, runId: number): Promise<CiRunView | null> {
  if (!safeRunId(runId)) return null;
  try {
    const { stdout } = await execAsync(`${ghPath()} run view ${runId} --json jobs,url`, {
      cwd,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const data = JSON.parse(stdout) as { url?: string; jobs?: CiJob[] };
    return { url: data.url, jobs: data.jobs ?? [] };
  } catch {
    return null;
  }
}

async function logFailedViaGh(cwd: string, runId: number): Promise<string | null> {
  if (!safeRunId(runId)) return null;
  try {
    const { stdout } = await execAsync(`${ghPath()} run view ${runId} --log-failed`, {
      cwd,
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024, // real failed-job logs run to tens of MB
    });
    return stdout;
  } catch (err) {
    log.debug({ err, runId }, '[ci-green-keeper] --log-failed unavailable');
    return null;
  }
}

const REAL_DEPS: CiWatchDeps = {
  listRuns: listRecentRuns,
  viewJobs: viewJobsViaGh,
  logFailed: logFailedViaGh,
};

const NO_DETAIL = '(失敗ジョブの詳細を取得できませんでした)';

/** Summarize failing jobs+steps (workflow-level concern body). */
function describeJobs(view: CiRunView | null, jobs: CiJob[] | null): string {
  if (!view || !jobs) return NO_DETAIL;
  const lines: string[] = [];
  for (const job of jobs) {
    const steps = failedStepNames(job).join(' / ');
    lines.push(`- ジョブ「${job.name}」${steps ? ` — 失敗ステップ: ${steps}` : ''}`);
  }
  if (view.url) lines.push(`\n実行ログ: ${view.url}`);
  return lines.join('\n') || NO_DETAIL;
}

function failedStepNames(job: CiJob): string[] {
  return (job.steps ?? [])
    .filter((s) => s.conclusion === 'failure' || s.conclusion === 'timed_out')
    .map((s) => s.name)
    .filter((n): n is string => !!n);
}

/**
 * Run one CI watch pass across themes with a working directory.
 *
 * @param deps - gh access (tests inject fakes) / gh呼び出し（テストで差し替え）
 * @returns Number of concerns filed. / 起票件数
 */
export async function runCiWatchWith(deps: CiWatchDeps): Promise<number> {
  const disabled = await getDisabledThemeIds('ci_watch').catch(() => new Set<number>());
  const themes = await prisma.theme.findMany({
    where: {
      workingDirectory: { not: null },
      ...(disabled.size > 0 ? { id: { notIn: [...disabled] } } : {}),
    },
    select: { id: true, name: true, workingDirectory: true, defaultBranch: true },
    take: MAX_THEMES,
  });

  let filed = 0;
  for (const theme of themes) {
    const dir = theme.workingDirectory;
    if (!dir || !existsSync(join(dir, '.git'))) continue;
    const branch = theme.defaultBranch?.trim() || 'develop';

    const runs = await deps.listRuns(dir, branch);
    if (!runs) continue;
    let red = 0;

    for (const run of pickLatestCompletedRuns(runs)) {
      const failing = run.conclusion === 'failure' || run.conclusion === 'timed_out';
      const advisoryNames = ADVISORY_JOBS[run.workflowName];
      // gh cost: jobs are read only for red runs and for workflows that own an
      // advisory job (whose red is invisible in the workflow conclusion).
      if (!failing && !advisoryNames) continue;

      const view = await deps.viewJobs(dir, run.databaseId);
      const failedJobs =
        view?.jobs.filter((j) => j.conclusion === 'failure' || j.conclusion === 'timed_out') ?? [];
      const advisoryFailures = view ? pickAdvisoryFailures(run.workflowName, view.jobs) : [];

      // Workflow-level concern: unchanged for real failures. When the ONLY red jobs
      // are advisory ones, the per-job concern below owns the signal (no double filing).
      const blocking = failedJobs.filter(
        (j) => j.conclusion !== 'failure' || !advisoryNames?.includes(j.name ?? ''),
      );
      if (failing && (!view || failedJobs.length === 0 || blocking.length > 0)) {
        red++;
        const detail = describeJobs(view, view ? blocking : null);
        if (await fileWorkflowConcern(theme, branch, run.workflowName, detail)) filed++;
      }

      const logText = advisoryFailures.length
        ? await deps.logFailed(dir, run.databaseId).catch(() => null)
        : null;
      for (const job of advisoryFailures) {
        red++;
        const body = buildJobConcernBody({
          branch,
          workflow: run.workflowName,
          jobName: job.name ?? '',
          stepNames: failedStepNames(job),
          testNames: logText ? extractFailedTestNames(logText, 10, job.name) : [],
          logUnavailable: logText === null,
          url: view?.url,
        });
        if (await fileJobConcern(theme, branch, run.workflowName, job, body)) filed++;
      }
    }
    if (red === 0) {
      log.info({ themeId: theme.id, branch }, '[ci-green-keeper] all workflows green');
    }
  }

  log.info({ filed, themes: themes.length }, '[ci-green-keeper] CI watch complete');
  return filed;
}

/** Scheduler entry point (backlog job kind 'ci_watch'). */
export async function runCiWatch(): Promise<number> {
  return runCiWatchWith(REAL_DEPS);
}

type ThemeRef = { id: number; name: string };

async function fileWorkflowConcern(
  theme: ThemeRef,
  branch: string,
  workflow: string,
  detail: string,
): Promise<boolean> {
  try {
    await submitConcern({
      title: `[CI赤] ${theme.name}/${branch}: ${workflow} が失敗しています`,
      detail:
        `本線ブランチ \`${branch}\` の最新の「${workflow}」実行が失敗しています。` +
        `CI が赤のままだと全ての品質信号が死ぬため、緑に戻すことを最優先で対応してください。

` +
        `失敗内容:
${detail}

` +
        `対応の型: 失敗ステップをローカルで再現 → 修正 → 同一チェックをローカルで緑化 → push で CI 再実行を確認。`,
      type: 'bug',
      severity: 'high',
      themeId: theme.id,
      source: 'ci_watch',
      // Stable per theme+workflow: a red that persists across runs updates
      // the open concern instead of stacking new ones.
      dedupKey: `ci-red:${theme.id}:${workflow}`,
    });
    return true;
  } catch (err) {
    log.warn({ err, themeId: theme.id, workflow }, 'concern filing failed');
    return false;
  }
}

async function fileJobConcern(
  theme: ThemeRef,
  branch: string,
  workflow: string,
  job: CiJob,
  body: string,
): Promise<boolean> {
  try {
    await submitConcern({
      title: `[CI赤] ${theme.name}/${branch}: ${workflow} / ${job.name} (advisory) が失敗しています`,
      detail: body,
      type: 'bug',
      severity: 'high',
      themeId: theme.id,
      source: 'ci_watch',
      // Theme+workflow+job, never the run id: a persisting red stays ONE concern.
      dedupKey: jobDedupKey(theme.id, workflow, job.name ?? ''),
    });
    return true;
  } catch (err) {
    log.warn({ err, themeId: theme.id, workflow, job: job.name }, 'job concern filing failed');
    return false;
  }
}
