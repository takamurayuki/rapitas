import { describe, test, expect, mock } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { classifyFailures, defaultSetupWorktree, triageTestFailures } from './test-triage';

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
      retryDelayMs: 0,
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
      retryDelayMs: 0,
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

// Task 659: a transient worktree-create / setup failure must be retried once
// before the triage gives up (null = indeterminate), and the retry must not
// leak a second baseline worktree or remove the wrong directory.
describe('triageTestFailures — baseline infra retries (task 659)', () => {
  const infra = {
    isTestFileFailingFn: () => Promise.resolve(true),
    resolveBaseCommitFn: () => Promise.resolve('abcdef'),
    getMainRepoRootFn: () => Promise.resolve('/main-repo'),
    retryDelayMs: 0,
  };

  test('worktree creation failing once then succeeding classifies normally, under a fresh dir', async () => {
    const createWorktreeFn = mock((_root: string, _dir: string, _commit: string) =>
      Promise.resolve(createWorktreeFn.mock.calls.length >= 2),
    );
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      ...infra,
      createWorktreeFn,
      setupWorktreeFn: () => Promise.resolve(true),
      removeWorktreeFn,
    });
    expect(result).toEqual({ preExisting: [], newFailures: ['a.test.ts'] });
    expect(createWorktreeFn).toHaveBeenCalledTimes(2);
    const [firstDir, secondDir] = createWorktreeFn.mock.calls.map((c) => c[1]);
    expect(secondDir).not.toBe(firstDir);
    // Cleanup targets the directory that was actually created (the 2nd), once.
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
    expect(removeWorktreeFn.mock.calls[0]?.[1]).toBe(secondDir);
  });

  test('worktree creation failing twice returns null (indeterminate) without cleanup', async () => {
    const createWorktreeFn = mock(() => Promise.resolve(false));
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      ...infra,
      createWorktreeFn,
      setupWorktreeFn: () => Promise.resolve(true),
      removeWorktreeFn,
    });
    expect(result).toBeNull();
    expect(createWorktreeFn).toHaveBeenCalledTimes(2);
    expect(removeWorktreeFn).not.toHaveBeenCalled();
  });

  test('setup failing once then succeeding classifies normally on the same dir', async () => {
    const createWorktreeFn = mock(() => Promise.resolve(true));
    const setupWorktreeFn = mock((_dir: string) =>
      Promise.resolve(setupWorktreeFn.mock.calls.length >= 2),
    );
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      ...infra,
      createWorktreeFn,
      setupWorktreeFn,
      removeWorktreeFn,
    });
    expect(result).toEqual({ preExisting: [], newFailures: ['a.test.ts'] });
    expect(createWorktreeFn).toHaveBeenCalledTimes(1);
    expect(setupWorktreeFn).toHaveBeenCalledTimes(2);
    expect(setupWorktreeFn.mock.calls[0]?.[0]).toBe(setupWorktreeFn.mock.calls[1]?.[0]);
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
  });

  test('setup failing twice returns null (indeterminate) and removes the worktree once', async () => {
    const setupWorktreeFn = mock(() => Promise.resolve(false));
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      ...infra,
      createWorktreeFn: () => Promise.resolve(true),
      setupWorktreeFn,
      removeWorktreeFn,
    });
    expect(result).toBeNull();
    expect(setupWorktreeFn).toHaveBeenCalledTimes(2);
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
  });
});

// Task 1161: generated projects have no scripts/setup-worktree.cjs, so the old
// setup always failed twice and left the test gate indeterminate (open). The
// default setup now delegates to the project bootstrap instead.
describe('defaultSetupWorktree — projects without setup-worktree.cjs (task 1161)', () => {
  const withTmpDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), 'triage-setup-'));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test('delegates to the bootstrap and succeeds when it linked dependencies', async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = mock((_p: string) =>
        Promise.resolve({ action: 'linked' as const, detail: '1 link(s): .' }),
      );
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(true);
      expect(bootstrapFn).toHaveBeenCalledWith(dir);
    });
  });

  test('succeeds when the bootstrap installed dependencies', async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = () =>
        Promise.resolve({ action: 'installed' as const, detail: '1 link(s): .' });
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(true);
    });
  });

  test('succeeds when the bootstrap skipped because node_modules is already usable', async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = () =>
        Promise.resolve({
          action: 'skipped' as const,
          detail: 'worktree already has usable node_modules',
        });
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(true);
    });
  });

  test("returns 'no-manifest' when the baseline has no project manifest", async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = () =>
        Promise.resolve({ action: 'skipped' as const, detail: 'no manifest' });
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe('no-manifest');
    });
  });

  test('returns false without leaking when the bootstrap throws', async () => {
    await withTmpDir(async (dir) => {
      const bootstrapFn = () => Promise.reject(new Error('install failed'));
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(false);
    });
  });

  test('runs a present setup script and skips the bootstrap', async () => {
    await withTmpDir(async (dir) => {
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts', 'setup-worktree.cjs'), 'process.exit(0);\n');
      const bootstrapFn = mock(() => Promise.resolve({ action: 'linked' as const, detail: '' }));
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(true);
      expect(bootstrapFn).not.toHaveBeenCalled();
    });
  });

  test('a present-but-failing setup script does not fall back to the bootstrap', async () => {
    await withTmpDir(async (dir) => {
      mkdirSync(join(dir, 'scripts'));
      writeFileSync(join(dir, 'scripts', 'setup-worktree.cjs'), 'process.exit(1);\n');
      const bootstrapFn = mock(() => Promise.resolve({ action: 'linked' as const, detail: '' }));
      expect(await defaultSetupWorktree(dir, bootstrapFn)).toBe(false);
      expect(bootstrapFn).not.toHaveBeenCalled();
    });
  });
});

describe("triageTestFailures — 'no-manifest' baseline (task 1161)", () => {
  test("returns null without retrying when setup reports 'no-manifest'", async () => {
    const setupWorktreeFn = mock((_dir: string) => Promise.resolve('no-manifest' as const));
    const removeWorktreeFn = mock(() => Promise.resolve());
    const result = await triageTestFailures('/root/proj', '/workdir', ['a.test.ts'], {
      isTestFileFailingFn: () => Promise.resolve(true),
      resolveBaseCommitFn: () => Promise.resolve('abcdef'),
      getMainRepoRootFn: () => Promise.resolve('/main-repo'),
      createWorktreeFn: () => Promise.resolve(true),
      setupWorktreeFn,
      removeWorktreeFn,
      retryDelayMs: 0,
    });
    expect(result).toBeNull();
    expect(setupWorktreeFn).toHaveBeenCalledTimes(1);
    expect(removeWorktreeFn).toHaveBeenCalledTimes(1);
  });
});
