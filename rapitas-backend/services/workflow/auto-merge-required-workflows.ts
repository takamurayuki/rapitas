/**
 * auto-merge-required-workflows
 *
 * Verifies that the workflows the auto-merge gate depends on (file-size ratchet,
 * test/lint) actually FINISHED on a PR's head SHA, and dispatches an unrun one.
 * NOT responsible for the merge decision itself — auto-merge-premerge-gate
 * composes this with the local ratchet check.
 *
 * Why: PR #707 merged via the "no blocking checks; merge state CLEAN" path with
 * file-size.yml never having run (its `paths` filter or timing), pushing a
 * ratchet-pinned file over its baseline and turning develop red (task 1021).
 */
import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { createLogger } from '../../config/logger';

const execAsync = promisify(exec);

// NOTE: local copy of auto-merge-checks' ghPath — importing it would couple this module to
// that file's (heavily mocked) exports.
export function ghExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? String.raw`"C:\Program Files\GitHub CLI\gh.exe"` : 'gh';
}
const ghPath = (): string => ghExecutable();
const log = createLogger('workflow:auto-merge-required-workflows');

/** Workflow files whose completion on the head SHA is required before merging. */
export const REQUIRED_WORKFLOW_FILES = ['file-size.yml', 'test-lint.yml'];

/** One workflow run as returned by `gh run list --json databaseId,status,conclusion`. */
export interface WorkflowRun {
  status: string;
  conclusion: string | null;
  /** Run id, used to read the run's jobs when the run-level verdict is not green. */
  databaseId?: number;
}

/** One job of a workflow run, as returned by `gh run view --json jobs`. */
export interface WorkflowJob {
  name: string;
  status: string;
  conclusion: string | null;
}

export type WorkflowRunVerdict = 'complete' | 'running' | 'missing' | 'failed';

/** Job conclusions that count as "this job did not fail". */
const PASSING_CONCLUSIONS = ['success', 'skipped', 'neutral'];

/**
 * Classify a workflow's runs on one commit. Pure.
 *
 * @param runs - Runs for the head SHA, newest first. / head SHA の run（新しい順）
 * @returns 'missing' when none exist; otherwise the verdict of the newest run. / 判定
 */
export function evaluateWorkflowRuns(runs: WorkflowRun[]): WorkflowRunVerdict {
  const newest = runs[0];
  if (!newest) return 'missing';
  if (newest.status !== 'completed') return 'running';
  return PASSING_CONCLUSIONS.includes(newest.conclusion ?? '') ? 'complete' : 'failed';
}

/**
 * Classify a run by its BLOCKING jobs only, ignoring advisory ones. Pure.
 *
 * The run-level verdict above answers "is this whole run green", which is a
 * stricter question than the gate needs and one an advisory job can veto: task
 * 1145's `Full Suite (Advisory)` hung 54 minutes in its browser-install step
 * and held test-lint.yml at in_progress, so a PR whose every blocking check had
 * passed could not merge. Cancelling the run was no escape — `cancelled` reads
 * as 'failed', which blocks the PR permanently.
 *
 * Returns null when the run exposes NO blocking job, so the caller keeps the
 * run-level verdict: judging on zero jobs would wave through a workflow that
 * never ran the gate this module exists to enforce (PR #707).
 *
 * @param jobs - The run's jobs. / run のジョブ一覧
 * @param blocking - Check/job names that gate the merge. / マージをゲートする名前
 * @returns The verdict, or null when no blocking job is present. / 判定（該当なしは null）
 */
export function evaluateWorkflowJobs(
  jobs: WorkflowJob[],
  blocking: Set<string>,
): 'complete' | 'running' | 'failed' | null {
  const relevant = jobs.filter((j) => blocking.has(j.name));
  if (relevant.length === 0) return null;
  if (relevant.some((j) => j.status !== 'completed')) return 'running';
  return relevant.every((j) => PASSING_CONCLUSIONS.includes(j.conclusion ?? ''))
    ? 'complete'
    : 'failed';
}

/** Injectable side effects so the orchestration is unit-testable. */
export interface RequiredWorkflowDeps {
  workflowExists: (cwd: string, file: string) => boolean;
  readHead: (cwd: string, prNumber: number) => Promise<{ sha: string; ref: string } | null>;
  readRuns: (cwd: string, file: string, sha: string) => Promise<WorkflowRun[] | null>;
  readRunJobs: (cwd: string, runId: number) => Promise<WorkflowJob[] | null>;
  dispatch: (cwd: string, file: string, ref: string) => Promise<boolean>;
}

// Keyed `${cwd}:${pr}:${sha}:${file}`. A restart merely re-dispatches once.
const dispatched = new Set<string>();

const defaultDeps: RequiredWorkflowDeps = {
  workflowExists: (cwd, file) => existsSync(path.join(cwd, '.github', 'workflows', file)),
  readHead: async (cwd, prNumber) => {
    try {
      const { stdout } = await execAsync(
        `${ghPath()} pr view ${prNumber} --json headRefOid,headRefName`,
        { cwd, encoding: 'utf8' },
      );
      const p = JSON.parse(stdout) as { headRefOid?: string; headRefName?: string };
      return p.headRefOid && p.headRefName ? { sha: p.headRefOid, ref: p.headRefName } : null;
    } catch (err) {
      log.warn({ err, prNumber }, '[auto-merge] Failed to read PR head for workflow check');
      return null;
    }
  },
  readRuns: async (cwd, file, sha) => {
    try {
      const { stdout } = await execAsync(
        `${ghPath()} run list --workflow ${file} --commit ${sha} --limit 10 --json databaseId,status,conclusion`,
        { cwd, encoding: 'utf8' },
      );
      return JSON.parse(stdout) as WorkflowRun[];
    } catch (err) {
      log.warn({ err, file }, '[auto-merge] Failed to list workflow runs');
      return null;
    }
  },
  readRunJobs: async (cwd, runId) => {
    try {
      const { stdout } = await execAsync(`${ghPath()} run view ${runId} --json jobs`, {
        cwd,
        encoding: 'utf8',
      });
      const parsed = JSON.parse(stdout) as { jobs?: WorkflowJob[] };
      return parsed.jobs ?? null;
    } catch (err) {
      log.warn({ err, runId }, '[auto-merge] Failed to read workflow run jobs');
      return null;
    }
  },
  dispatch: async (cwd, file, ref) => {
    try {
      await execAsync(`${ghPath()} workflow run ${file} --ref "${ref}"`, { cwd, encoding: 'utf8' });
      return true;
    } catch (err) {
      // Workflows without a workflow_dispatch trigger reject this; not fatal.
      log.warn({ err, file, ref }, '[auto-merge] workflow_dispatch failed');
      return false;
    }
  },
};

/**
 * Check that every required workflow defined in the repo completed on the PR head.
 * Unrun workflows are dispatched once per head SHA. Fails closed on gh errors.
 *
 * @param cwd - Repo working directory / リポジトリ作業ディレクトリ
 * @param prNumber - PR number / PR番号
 * @param deps - Injectable side effects (tests). / 依存注入
 * @param blocking - Job names that gate the merge; a run held open or reddened
 *   only by jobs OUTSIDE this set no longer blocks (task 1145). Omit to keep the
 *   stricter run-level judgement. / マージをゲートするジョブ名
 * @returns complete=true only when nothing is missing/running/failed; waiting lists the rest. / 完走判定
 */
export async function checkRequiredWorkflows(
  cwd: string,
  prNumber: number,
  deps: RequiredWorkflowDeps = defaultDeps,
  blocking?: Set<string>,
): Promise<{ complete: boolean; waiting: string[] }> {
  const files = REQUIRED_WORKFLOW_FILES.filter((f) => deps.workflowExists(cwd, f));
  // Repos without these workflows (other projects) keep the legacy behaviour.
  if (files.length === 0) return { complete: true, waiting: [] };

  const head = await deps.readHead(cwd, prNumber);
  if (!head) return { complete: false, waiting: ['(head unreadable)'] };

  const waiting: string[] = [];
  for (const file of files) {
    const runs = await deps.readRuns(cwd, file, head.sha);
    if (runs === null) {
      waiting.push(file);
      continue;
    }
    const verdict = evaluateWorkflowRuns(runs);
    if (verdict === 'complete') continue;

    // The run is not green as a whole. Before waiting, ask the narrower
    // question the gate actually needs: are this run's BLOCKING jobs green?
    // 'missing' is never escalated — there is no run to inspect, and that is
    // the case this module exists for. A job read that fails keeps the stricter
    // run-level verdict (fails closed).
    if (blocking && verdict !== 'missing') {
      const runId = runs[0]?.databaseId;
      const jobs = runId == null ? null : await deps.readRunJobs(cwd, runId);
      if (jobs && evaluateWorkflowJobs(jobs, blocking) === 'complete') {
        log.info(
          { file, runId, prNumber },
          '[auto-merge] Required workflow is only held open by non-blocking jobs — treating as complete',
        );
        continue;
      }
    }

    waiting.push(file);
    if (verdict === 'missing') {
      const key = `${cwd}:${prNumber}:${head.sha}:${file}`;
      if (!dispatched.has(key)) {
        dispatched.add(key);
        await deps.dispatch(cwd, file, head.ref);
      }
    }
  }
  return { complete: waiting.length === 0, waiting };
}
