/**
 * auto-merge-required-workflows test
 *
 * Pins that a PR is only "complete" once every required workflow finished on its
 * head SHA, and that an unrun workflow is dispatched at most once (task 1021 —
 * PR #707 merged with file-size never having run).
 */
import { describe, it, expect } from 'bun:test';
import {
  evaluateWorkflowRuns,
  evaluateWorkflowJobs,
  checkRequiredWorkflows,
  ghExecutable,
  type RequiredWorkflowDeps,
} from './auto-merge-required-workflows';

describe('evaluateWorkflowRuns', () => {
  it('is missing when no run exists for the head SHA', () => {
    expect(evaluateWorkflowRuns([])).toBe('missing');
  });
  it('is running while the newest run is not completed', () => {
    expect(evaluateWorkflowRuns([{ status: 'in_progress', conclusion: null }])).toBe('running');
    expect(evaluateWorkflowRuns([{ status: 'queued', conclusion: null }])).toBe('running');
  });
  it('is complete for success / skipped / neutral', () => {
    for (const conclusion of ['success', 'skipped', 'neutral']) {
      expect(evaluateWorkflowRuns([{ status: 'completed', conclusion }])).toBe('complete');
    }
  });
  it('is failed for a red completed run', () => {
    expect(evaluateWorkflowRuns([{ status: 'completed', conclusion: 'failure' }])).toBe('failed');
  });
  it('judges by the newest run (first) when a rerun exists', () => {
    expect(
      evaluateWorkflowRuns([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'failure' },
      ]),
    ).toBe('complete');
  });
});

// task 1145 (2026-10-07): `Full Suite (Advisory)` hung 54 minutes in its browser
// install step. It is deliberately NOT in the blocking-check set, yet it held
// test-lint.yml at in_progress, so the run-level verdict was 'running' and the
// merge waited on a job that cannot gate it. Cancelling was no escape either: a
// `cancelled` run reads as 'failed', blocking the PR permanently.
describe('evaluateWorkflowJobs', () => {
  const BLOCKING = new Set(['Test Backend', 'Lint Code']);

  it('is complete once every BLOCKING job is green, however an advisory job ends', () => {
    for (const advisory of [
      { status: 'in_progress', conclusion: null },
      { status: 'completed', conclusion: 'failure' },
      { status: 'completed', conclusion: 'cancelled' },
      { status: 'queued', conclusion: null },
    ]) {
      expect(
        evaluateWorkflowJobs(
          [
            { name: 'Test Backend', status: 'completed', conclusion: 'success' },
            { name: 'Lint Code', status: 'completed', conclusion: 'success' },
            { name: 'Full Suite (Advisory)', ...advisory },
          ],
          BLOCKING,
        ),
      ).toBe('complete');
    }
  });

  it('is running while a blocking job has not finished', () => {
    expect(
      evaluateWorkflowJobs(
        [
          { name: 'Test Backend', status: 'completed', conclusion: 'success' },
          { name: 'Lint Code', status: 'queued', conclusion: null },
        ],
        BLOCKING,
      ),
    ).toBe('running');
  });

  it('is failed when a blocking job is red or cancelled', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
      expect(
        evaluateWorkflowJobs([{ name: 'Lint Code', status: 'completed', conclusion }], BLOCKING),
      ).toBe('failed');
    }
  });

  it('accepts skipped and neutral blocking jobs, as the run-level verdict does', () => {
    for (const conclusion of ['skipped', 'neutral']) {
      expect(
        evaluateWorkflowJobs([{ name: 'Lint Code', status: 'completed', conclusion }], BLOCKING),
      ).toBe('complete');
    }
  });

  it('returns null when the run carries no blocking job, so the caller keeps the run-level verdict', () => {
    // file-size.yml under a renamed check, or a workflow whose jobs are all
    // advisory: judging on zero jobs would wave through a workflow that never
    // ran its gate. The caller must fall back rather than assume green.
    expect(
      evaluateWorkflowJobs(
        [{ name: 'Post Preview Info', status: 'completed', conclusion: 'success' }],
        BLOCKING,
      ),
    ).toBeNull();
    expect(evaluateWorkflowJobs([], BLOCKING)).toBeNull();
  });
});

function makeDeps(over: Partial<RequiredWorkflowDeps> = {}): RequiredWorkflowDeps & {
  dispatched: string[];
} {
  const dispatched: string[] = [];
  return {
    dispatched,
    workflowExists: () => true,
    readHead: async () => ({ sha: 'abc', ref: 'feature/x' }),
    readRuns: async () => [],
    readRunJobs: async () => null,
    dispatch: async (_cwd, file) => {
      dispatched.push(file);
      return true;
    },
    ...over,
  };
}

describe('checkRequiredWorkflows', () => {
  it('is not complete and dispatches each unrun workflow exactly once', async () => {
    const deps = makeDeps();
    const a = await checkRequiredWorkflows('/repo', 1, deps);
    const b = await checkRequiredWorkflows('/repo', 1, deps);
    expect(a.complete).toBe(false);
    expect(b.complete).toBe(false);
    expect(deps.dispatched.sort()).toEqual(['file-size.yml', 'test-lint.yml']);
  });

  it('dispatches again for a new head SHA', async () => {
    const deps = makeDeps();
    await checkRequiredWorkflows('/repo', 2, deps);
    const deps2 = { ...deps, readHead: async () => ({ sha: 'def', ref: 'feature/x' }) };
    await checkRequiredWorkflows('/repo', 2, deps2);
    expect(deps.dispatched.length).toBe(4);
  });

  it('is complete when every required workflow completed green', async () => {
    const deps = makeDeps({
      readRuns: async () => [{ status: 'completed', conclusion: 'success' }],
    });
    const r = await checkRequiredWorkflows('/repo', 3, deps);
    expect(r.complete).toBe(true);
    expect(deps.dispatched).toEqual([]);
  });

  it('is not complete while one workflow is still running, and does not dispatch it', async () => {
    const deps = makeDeps({
      readRuns: async (_cwd, file) =>
        file === 'file-size.yml'
          ? [{ status: 'in_progress', conclusion: null }]
          : [{ status: 'completed', conclusion: 'success' }],
    });
    const r = await checkRequiredWorkflows('/repo', 4, deps);
    expect(r.complete).toBe(false);
    expect(deps.dispatched).toEqual([]);
  });

  it('is complete (unchanged behaviour) when the repo defines none of the workflows', async () => {
    const deps = makeDeps({ workflowExists: () => false });
    const r = await checkRequiredWorkflows('/other-repo', 5, deps);
    expect(r.complete).toBe(true);
  });

  it('fails closed when gh cannot be read', async () => {
    expect(
      (await checkRequiredWorkflows('/repo', 6, makeDeps({ readHead: async () => null }))).complete,
    ).toBe(false);
    expect(
      (await checkRequiredWorkflows('/repo', 7, makeDeps({ readRuns: async () => null }))).complete,
    ).toBe(false);
  });

  it('does not throw when dispatch fails', async () => {
    const deps = makeDeps({ dispatch: async () => false });
    const r = await checkRequiredWorkflows('/repo', 8, deps);
    expect(r.complete).toBe(false);
  });

  // task 1145: the escalation from the run-level verdict to the job-level one.
  it('is complete when a workflow is only held open by a non-blocking job', async () => {
    const deps = makeDeps({
      readRuns: async (_cwd, file) =>
        file === 'test-lint.yml'
          ? [{ databaseId: 99, status: 'in_progress', conclusion: null }]
          : [{ databaseId: 98, status: 'completed', conclusion: 'success' }],
      readRunJobs: async () => [
        { name: 'Test Backend', status: 'completed', conclusion: 'success' },
        { name: 'Lint Code', status: 'completed', conclusion: 'success' },
        { name: 'Full Suite (Advisory)', status: 'in_progress', conclusion: null },
      ],
    });
    const r = await checkRequiredWorkflows(
      '/repo',
      10,
      deps,
      new Set(['Test Backend', 'Lint Code']),
    );
    expect(r.complete).toBe(true);
    expect(r.waiting).toEqual([]);
  });

  it('still waits when the job-level view shows a blocking job unfinished', async () => {
    const deps = makeDeps({
      readRuns: async () => [{ databaseId: 99, status: 'in_progress', conclusion: null }],
      readRunJobs: async () => [{ name: 'Lint Code', status: 'in_progress', conclusion: null }],
    });
    const r = await checkRequiredWorkflows('/repo', 11, deps, new Set(['Lint Code']));
    expect(r.complete).toBe(false);
  });

  it('keeps the run-level verdict when the jobs cannot be read (fails closed)', async () => {
    const deps = makeDeps({
      readRuns: async () => [{ databaseId: 99, status: 'completed', conclusion: 'failure' }],
      readRunJobs: async () => null,
    });
    const r = await checkRequiredWorkflows('/repo', 12, deps, new Set(['Lint Code']));
    expect(r.complete).toBe(false);
  });

  it('never escalates a MISSING workflow to the job view — it still dispatches', async () => {
    const deps = makeDeps({
      readRuns: async () => [],
      readRunJobs: async () => [{ name: 'Lint Code', status: 'completed', conclusion: 'success' }],
    });
    const r = await checkRequiredWorkflows('/repo', 13, deps, new Set(['Lint Code']));
    expect(r.complete).toBe(false);
    expect(deps.dispatched.sort()).toEqual(['file-size.yml', 'test-lint.yml']);
  });

  it('does not read jobs at all on the green fast path', async () => {
    let jobReads = 0;
    const deps = makeDeps({
      readRuns: async () => [{ databaseId: 1, status: 'completed', conclusion: 'success' }],
      readRunJobs: async () => {
        jobReads += 1;
        return null;
      },
    });
    const r = await checkRequiredWorkflows('/repo', 14, deps, new Set(['Lint Code']));
    expect(r.complete).toBe(true);
    expect(jobReads).toBe(0);
  });
});

describe('ghExecutable', () => {
  it('keeps every backslash in the win32 install path (regression: lost separators broke gh)', () => {
    expect(ghExecutable('win32')).toBe(String.raw`"C:\Program Files\GitHub CLI\gh.exe"`);
  });
  it('uses plain gh elsewhere', () => {
    expect(ghExecutable('linux')).toBe('gh');
  });
});
