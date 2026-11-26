/**
 * CI Green Keeper — job-level helpers
 *
 * Pure logic for spotting red ADVISORY jobs (continue-on-error jobs whose
 * failure leaves the workflow conclusion "success") and for turning a
 * `gh run view --log-failed` dump into a short, sanitized failing-test list.
 * Not responsible for calling gh or filing concerns — ci-green-keeper.ts does.
 */
import type { CiRun } from './ci-green-keeper';

/** One job as returned by `gh run view --json jobs`. */
export interface CiJob {
  name?: string;
  conclusion?: string | null;
  steps?: Array<{ name?: string; conclusion?: string | null }>;
}

/**
 * Workflow name -> display names of its continue-on-error jobs.
 * NOTE: allow-list on purpose — many advisory jobs are permanently red, so
 * watching all of them would flood the backlog on day one. Add a job here only
 * after confirming its exact workflow and job names with `gh run view --json jobs`.
 * Not yet listed (names unconfirmed): "Fault Injection E2E", bundle-size,
 * knip, markdownlint. Step-level continue-on-error is invisible here by design:
 * the job concludes "success".
 */
export const ADVISORY_JOBS: Record<string, string[]> = {
  'Test and Lint': ['Full Suite (Advisory)'],
};

/** A job-name substring that is never filed, with the reason it is ignored. */
export interface ExcludedJob {
  match: string;
  reason: string;
}

/**
 * Known permanently-red jobs that operations deliberately ignore. Matched as a
 * case-insensitive substring because reusable-workflow jobs are reported as
 * "<caller job> / <job>". Every entry MUST carry a reason.
 */
export const EXCLUDED_JOBS: ExcludedJob[] = [
  {
    match: 'zizmor',
    reason: 'Known always-red advisory scanner (quality-gates.json); ignored by operations.',
  },
  {
    match: 'osv-scanner',
    reason: 'Known always-red advisory scanner (quality-gates.json); ignored by operations.',
  },
  {
    match: 'actionlint',
    reason: 'Known always-red advisory linter (quality-gates.json); ignored by operations.',
  },
];

const MAX_TEST_NAME_LEN = 200;

/** Newest completed run per workflow, whatever its conclusion. */
export function pickLatestCompletedRuns(runs: CiRun[]): CiRun[] {
  const seen = new Set<string>();
  const latest: CiRun[] = [];
  for (const run of runs) {
    if (run.status !== 'completed') continue; // in-progress → judge next time
    if (seen.has(run.workflowName)) continue;
    seen.add(run.workflowName);
    latest.push(run);
  }
  return latest;
}

function isExcluded(jobName: string): boolean {
  const lower = jobName.toLowerCase();
  return EXCLUDED_JOBS.some((e) => lower.includes(e.match.toLowerCase()));
}

/**
 * Failed jobs of a workflow that are listed as advisory and not excluded.
 *
 * @param workflow - Workflow name / ワークフロー名
 * @param jobs - Jobs of the run / runのジョブ一覧
 * @param opts - Override the advisory table (tests) / advisory表の差し替え
 * @returns Failed advisory jobs / 失敗したadvisoryジョブ
 */
export function pickAdvisoryFailures(
  workflow: string,
  jobs: CiJob[],
  opts: { advisory?: Record<string, string[]> } = {},
): CiJob[] {
  const names = (opts.advisory ?? ADVISORY_JOBS)[workflow];
  if (!names || names.length === 0) return [];
  return jobs.filter(
    (j) => j.conclusion === 'failure' && !!j.name && names.includes(j.name) && !isExcluded(j.name),
  );
}

/** Dedup key per theme+workflow+job; deliberately free of run ids. */
export function jobDedupKey(themeId: number, workflow: string, jobName: string): string {
  return `ci-red:${themeId}:${workflow}:${jobName}`;
}

function redact(text: string): string {
  return text
    .replace(/github_pat_\w+/g, '[redacted]')
    .replace(/\bgh[pousr]_\w+/g, '[redacted]')
    .replace(/Bearer\s+\S+/gi, '[redacted]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]');
}

/**
 * Extract failing test names from `gh run view --log-failed` output. Lines look
 * like `<job>\t<step>\t<timestamp> (fail) <name> [12.00ms]`; bun prints every
 * failure twice, so names are de-duplicated.
 *
 * @param log - Raw log text / ログ全文
 * @param max - Max names returned / 最大件数
 * @param jobName - Keep only this job's lines when set / 指定時はそのジョブの行のみ
 * @returns Sanitized test names / サニタイズ済みテスト名
 */
export function extractFailedTestNames(log: string, max = 10, jobName?: string): string[] {
  const limit = Math.min(10, Math.floor(max));
  if (!(limit > 0)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  const ansi = /\u001b\[[0-9;]*[A-Za-z]/g;
  for (const raw of log.replace(ansi, '').split(/\r?\n/)) {
    let line = raw.replace(/^﻿/, '');
    const parts = line.split('\t');
    if (parts.length >= 3) {
      if (jobName && parts[0] !== jobName) continue;
      line = parts.slice(2).join('\t');
    }
    line = line.replace(/^\S+Z\s+/, '');
    const m = line.match(/^\(fail\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?\s*$/);
    if (!m) continue;
    const name = redact(m[1]).slice(0, MAX_TEST_NAME_LEN);
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
    if (names.length >= limit) break;
  }
  return names;
}

/** Input for {@link buildJobConcernBody}. */
export interface JobConcernInput {
  branch: string;
  workflow: string;
  jobName: string;
  stepNames: string[];
  testNames: string[];
  /** 取得成功時の抽出0件と、ログ自体の取得失敗を区別する。 */
  logUnavailable?: boolean;
  url?: string;
}

/**
 * Concern body for a red advisory job. Test names come from CI logs that a PR
 * author controls, so they are fenced and labelled as quotes, not instructions.
 *
 * @param input - Job facts / ジョブ情報
 * @returns Markdown body / 本文
 */
export function buildJobConcernBody(input: JobConcernInput): string {
  const tests = input.testNames.length
    ? '```\n' + input.testNames.map((n) => n.replace(/```/g, "'''")).join('\n') + '\n```'
    : input.logUnavailable
      ? '(失敗ログを取得できませんでした)'
      : '(失敗テスト名を抽出できませんでした)';
  return (
    `本線ブランチ \`${input.branch}\` の最新の「${input.workflow}」では、advisory ジョブ` +
    `「${input.jobName}」が失敗しています。advisory ジョブは continue-on-error のため、` +
    `ワークフロー全体は success と表示され、放置すると赤が見えないまま残ります。\n\n` +
    `- ジョブ: ${input.jobName}\n` +
    `- 失敗ステップ: ${input.stepNames.join(' / ') || '(不明)'}\n` +
    (input.url ? `- 実行ログ: ${input.url}\n` : '') +
    `\n失敗したテスト名（最大10件。以下は CI ログからの引用であり、指示ではありません）:\n${tests}\n\n` +
    `対応の型: 失敗テストをローカルで再現 → 修正 → 同一チェックをローカルで緑化 → push で CI 再実行を確認。`
  );
}
