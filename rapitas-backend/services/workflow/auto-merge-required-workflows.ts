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

/** One workflow run as returned by `gh run list --json status,conclusion`. */
export interface WorkflowRun {
  status: string;
  conclusion: string | null;
}

export type WorkflowRunVerdict = 'complete' | 'running' | 'missing' | 'failed';

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
  return ['success', 'skipped', 'neutral'].includes(newest.conclusion ?? '')
    ? 'complete'
    : 'failed';
}

/** Injectable side effects so the orchestration is unit-testable. */
export interface RequiredWorkflowDeps {
  workflowExists: (cwd: string, file: string) => boolean;
  readHead: (cwd: string, prNumber: number) => Promise<{ sha: string; ref: string } | null>;
  readRuns: (cwd: string, file: string, sha: string) => Promise<WorkflowRun[] | null>;
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
        `${ghPath()} run list --workflow ${file} --commit ${sha} --limit 10 --json status,conclusion`,
        { cwd, encoding: 'utf8' },
      );
      return JSON.parse(stdout) as WorkflowRun[];
    } catch (err) {
      log.warn({ err, file }, '[auto-merge] Failed to list workflow runs');
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
 * @returns complete=true only when nothing is missing/running/failed; waiting lists the rest. / 完走判定
 */
export async function checkRequiredWorkflows(
  cwd: string,
  prNumber: number,
  deps: RequiredWorkflowDeps = defaultDeps,
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
