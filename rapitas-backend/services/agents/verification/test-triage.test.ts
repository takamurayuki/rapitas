import { describe, test, expect, mock } from 'bun:test';
import { classifyFailures, triageTestFailures } from './test-triage';

describe('classifyFailures', () => {
  test('splits currently-failing files into pre-existing and new', () => {
    const result = classifyFailures(
      ['a.test.ts', 'b.test.ts', 'c.test.ts'],
      new Set(['a.test.ts']),
    );
    expect(result.preExisting).toEqual(['a.test.ts']);
    expect(result.newFailures).toEqual(['b.test.ts', 'c.test.ts']);
  });

  test('returns empty arrays when nothing is currently failing', () => {
    expect(classifyFailures([], new Set(['a.test.ts']))).toEqual({
      preExisting: [],
      newFailures: [],
    });
  });

  test('classifies everything as new when the baseline set is empty', () => {
    expect(classifyFailures(['a.test.ts'], new Set())).toEqual({
      preExisting: [],
      newFailures: ['a.test.ts'],
    });
  });

  test('classifies everything as pre-existing when all are in the baseline', () => {
    expect(
      classifyFailures(['a.test.ts', 'b.test.ts'], new Set(['a.test.ts', 'b.test.ts'])),
    ).toEqual({ preExisting: ['a.test.ts', 'b.test.ts'], newFailures: [] });
  });
});

describe('triageTestFailures', () => {
  test('returns empty classification immediately when scopedTestFiles is empty', async () => {
    const result = await triageTestFailures('/root', '/workdir', []);
    expect(result).toEqual({ preExisting: [], newFailures: [] });
  });

  test('returns empty classification when nothing is currently failing', async () => {
    const isTestFileFailingFn = mock(() => Promise.resolve(false));
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn,
    });
    expect(result).toEqual({ preExisting: [], newFailures: [] });
    expect(isTestFileFailingFn).toHaveBeenCalledTimes(1);
  });

  test('returns null when the merge-base commit cannot be resolved', async () => {
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve(null),
    });
    expect(result).toBeNull();
  });

  test('returns null when the main repo root cannot be resolved', async () => {
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve(null),
    });
    expect(result).toBeNull();
  });

  test('returns null when creating the baseline worktree fails, and does not attempt removal', async () => {
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.resolve(false),
      removeWorktreeFn,
    });
    expect(result).toBeNull();
    expect(removeWorktreeFn).not.toHaveBeenCalled();
  });

  test('returns null when baseline setup fails, but still removes the worktree', async () => {
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.resolve(true),
      setupWorktreeFn: () => Promise.resolve(false),
      removeWorktreeFn,
    });
    expect(result).toBeNull();
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
  });

  test('classifies a file as new when it does not exist in the baseline (existsSync false)', async () => {
    const removeWorktreeFn = mock(() => Promise.resolve());
    // isTestFileFailingFn is only used for the CURRENT-worktree check here
    // (existsSync gates the baseline check before isFailing would be called
    // against the baseline path) — return true so it's in currentFailing.
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.resolve(true),
      setupWorktreeFn: () => Promise.resolve(true),
      removeWorktreeFn,
    });
    // The baseline file path (under a randomly-named .worktrees/triage-* dir)
    // will never exist on the real filesystem in this test, so it's treated
    // as newly-added by the agent -> a new failure, not pre-existing.
    expect(result).toEqual({ preExisting: [], newFailures: ['a.test.ts'] });
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
  });

  test('propagates an unexpected error as null (fail-safe) and still cleans up', async () => {
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.reject(new Error('boom')),
      removeWorktreeFn,
    });
    expect(result).toBeNull();
  });

  test('a rejecting removeWorktreeFn does not throw out of triageTestFailures', async () => {
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.resolve(true),
      setupWorktreeFn: () => Promise.resolve(true),
      removeWorktreeFn: () => Promise.reject(new Error('cleanup failed')),
    });
    expect(result).toEqual({ preExisting: [], newFailures: ['a.test.ts'] });
  });
});
