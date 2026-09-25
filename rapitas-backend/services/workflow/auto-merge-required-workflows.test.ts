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

function makeDeps(over: Partial<RequiredWorkflowDeps> = {}): RequiredWorkflowDeps & {
  dispatched: string[];
} {
  const dispatched: string[] = [];
  return {
    dispatched,
    workflowExists: () => true,
    readHead: async () => ({ sha: 'abc', ref: 'feature/x' }),
    readRuns: async () => [],
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
});

describe('ghExecutable', () => {
  it('keeps every backslash in the win32 install path (regression: lost separators broke gh)', () => {
    expect(ghExecutable('win32')).toBe(String.raw`"C:\Program Files\GitHub CLI\gh.exe"`);
  });
  it('uses plain gh elsewhere', () => {
    expect(ghExecutable('linux')).toBe('gh');
  });
});
