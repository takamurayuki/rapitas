/**
 * AutoMergeCiAttribution
 *
 * Decides whether a PR's failing CI checks are the PR's own fault or are
 * inherited from the base branch. ci_repair bounced task 847 three times on
 * 2026-09-05 against failures (a grown line-limit baseline, red tests on
 * develop) that no change inside the PR could fix; every bounce burned an
 * implementer run and a repair-budget slot. A check that also fails on the
 * base branch's latest completed run of the same workflow is not evidence
 * against the PR. Not responsible for deciding what to do about it — see
 * handleCiFailure in auto-merge-ci-failure.ts.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createLogger } from '../../config/logger';
import { ghPath } from './auto-merge-checks';

const execAsync = promisify(exec);
const log = createLogger('workflow:auto-merge-ci-attribution');

/** Recent base-branch runs fetched — enough to cover every workflow's latest. */
const BASE_RUNS_FETCHED = 20;

interface BaseRun {
  databaseId: number;
  workflowName: string;
  status: string;
  conclusion: string | null;
}

interface RunJob {
  name: string;
  conclusion: string | null;
}

/** Minimal command runner so tests can substitute gh. */
export type CommandRunner = (command: string, cwd: string) => Promise<string>;

const defaultRunner: CommandRunner = async (command, cwd) => {
  const { stdout } = await execAsync(command, { cwd, encoding: 'utf8' });
  return stdout;
};

/**
 * Latest completed run per workflow on the base branch.
 *
 * @param runs - `gh run list` rows, newest first / 実行一覧(新しい順)
 * @returns One run per workflow name / ワークフロー毎の最新完了実行
 */
export function latestCompletedPerWorkflow(runs: BaseRun[]): BaseRun[] {
  const seen = new Map<string, BaseRun>();
  for (const run of runs) {
    if (run.status !== 'completed') continue;
    if (!seen.has(run.workflowName)) seen.set(run.workflowName, run);
  }
  return [...seen.values()];
}

/**
 * Names of jobs failing on the base branch right now.
 *
 * @param cwd - Repo working directory / リポジトリ作業ディレクトリ
 * @param baseBranch - PR base branch / ベースブランチ
 * @param run - Command runner (gh) / コマンド実行関数
 * @returns Failing job names, empty on any gh error (fail-open: attribute to the PR) / 失敗ジョブ名
 */
export async function readBaseFailingJobs(
  cwd: string,
  baseBranch: string,
  run: CommandRunner = defaultRunner,
): Promise<Set<string>> {
  const failing = new Set<string>();
  try {
    const listOut = await run(
      `${ghPath()} run list --branch ${JSON.stringify(baseBranch)} --limit ${BASE_RUNS_FETCHED} --json databaseId,workflowName,status,conclusion`,
      cwd,
    );
    const latest = latestCompletedPerWorkflow(JSON.parse(listOut) as BaseRun[]);
    for (const r of latest) {
      if (r.conclusion !== 'failure') continue;
      const jobsOut = await run(`${ghPath()} run view ${r.databaseId} --json jobs`, cwd);
      const { jobs } = JSON.parse(jobsOut) as { jobs: RunJob[] };
      for (const j of jobs) if (j.conclusion === 'failure') failing.add(j.name);
    }
  } catch (err) {
    // Fail-open on purpose: with no base evidence the failure stays the PR's.
    log.warn({ err, baseBranch }, '[ci-attribution] Could not read base-branch CI state');
  }
  return failing;
}

/**
 * Split a PR's failing checks into inherited (also red on base) and own.
 *
 * @param failedChecks - Failing blocking check names on the PR / PR側の失敗チェック名
 * @param baseFailing - Failing job names on the base branch / ベース側の失敗ジョブ名
 * @returns Inherited and own check names / 継承分と自前分
 */
export function splitInheritedFailures(
  failedChecks: string[],
  baseFailing: Set<string>,
): { inherited: string[]; own: string[] } {
  const inherited: string[] = [];
  const own: string[] = [];
  for (const name of failedChecks) (baseFailing.has(name) ? inherited : own).push(name);
  return { inherited, own };
}
