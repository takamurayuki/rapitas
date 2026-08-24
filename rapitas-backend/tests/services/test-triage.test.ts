/**
 * test-triage.test
 *
 * Unit tests for the classifyFailures pure function and the injectable paths
 * of triageTestFailures. I/O-heavy paths (git worktree creation, bun test
 * execution) are covered via injected dependency overrides so no real git
 * operations are needed in this test file.
 */
import { describe, it, expect } from 'bun:test';
import {
  classifyFailures,
  triageTestFailures,
} from '../../services/agents/verification/test-triage';

// ─────────────────────────────────────────────────────────────────────────────
// classifyFailures — pure function, no mocking needed
// ─────────────────────────────────────────────────────────────────────────────

describe('classifyFailures', () => {
  it('classifies pre-existing failures correctly (subset of current in baseline)', () => {
    const result = classifyFailures(['a.test.ts', 'b.test.ts'], new Set(['a.test.ts']));
    expect(result.preExisting).toEqual(['a.test.ts']);
    expect(result.newFailures).toEqual(['b.test.ts']);
  });

  it('treats all failures as new when baseline is empty', () => {
    const result = classifyFailures(['a.test.ts'], new Set());
    expect(result.preExisting).toEqual([]);
    expect(result.newFailures).toEqual(['a.test.ts']);
  });

  it('treats an agent-added test file as new (not present in baseline)', () => {
    const result = classifyFailures(['new-agent-added.test.ts'], new Set(['existing.test.ts']));
    expect(result.preExisting).toEqual([]);
    expect(result.newFailures).toEqual(['new-agent-added.test.ts']);
  });

  it('classifies all as pre-existing when every current failure is in baseline', () => {
    const result = classifyFailures(
      ['a.test.ts', 'b.test.ts'],
      new Set(['a.test.ts', 'b.test.ts', 'c.test.ts']),
    );
    expect(result.preExisting).toEqual(['a.test.ts', 'b.test.ts']);
    expect(result.newFailures).toEqual([]);
  });

  it('returns empty arrays when currentFailing is empty', () => {
    const result = classifyFailures([], new Set(['a.test.ts']));
    expect(result.preExisting).toEqual([]);
    expect(result.newFailures).toEqual([]);
  });

  it('handles both empty inputs', () => {
    const result = classifyFailures([], new Set());
    expect(result.preExisting).toEqual([]);
    expect(result.newFailures).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// triageTestFailures — injectable-dep paths (no real git/bun)
// ─────────────────────────────────────────────────────────────────────────────

/** No-op worktree removal for tests that create a baseline. */
const noopRemove = async (_b: string, _p: string, _d: boolean): Promise<void> => {};

describe('triageTestFailures', () => {
  // eslint-disable-next-line local/prefer-test-each-for-similar -- rule ignores the it.each below when counting adjacency; these 3 plain its differ in call arity/mocks/assertions (empty-input early return, all-non-failing path, and a cleanup-flag check) and aren't safely parameterizable together
  it('returns empty result when scopedTestFiles is empty', async () => {
    const result = await triageTestFailures('/fake/project', '/fake/work', []);
    expect(result).toEqual({ preExisting: [], newFailures: [] });
  });

  it('returns empty result when no files are currently failing', async () => {
    const result = await triageTestFailures(
      '/fake/project',
      '/fake/work',
      ['a.test.ts', 'b.test.ts'],
      {
        isTestFileFailingFn: async () => false,
        resolveBaseCommitFn: async () => 'abc1234',
        getMainRepoRootFn: async () => '/fake/main',
        createWorktreeFn: async () => true,
        setupWorktreeFn: async () => true,
        removeWorktreeFn: noopRemove,
      },
    );
    expect(result).toEqual({ preExisting: [], newFailures: [] });
  });

  it.each([
    {
      label: 'merge-base cannot be resolved',
      isTestFileFailingFn: async () => true,
      resolveBaseCommitFn: async () => null, // infrastructure failure
      getMainRepoRootFn: async () => '/fake/main',
      createWorktreeFn: async () => true,
      setupWorktreeFn: async () => true,
    },
    {
      label: 'main repo root cannot be resolved',
      isTestFileFailingFn: async () => true,
      resolveBaseCommitFn: async () => 'abc1234',
      getMainRepoRootFn: async () => null, // infrastructure failure
      createWorktreeFn: async () => true,
      setupWorktreeFn: async () => true,
    },
    {
      label: 'baseline worktree creation fails on every attempt',
      isTestFileFailingFn: async () => true,
      resolveBaseCommitFn: async () => 'abc1234',
      getMainRepoRootFn: async () => '/fake/main',
      createWorktreeFn: async () => false, // git worktree add failed (retried once, still failing)
      setupWorktreeFn: async () => true,
    },
  ])('returns null (indeterminate) when $label', async (overrides) => {
    const { label: _label, ...deps } = overrides;
    const result = await triageTestFailures('/fake/project', '/fake/work', ['a.test.ts'], {
      ...deps,
      removeWorktreeFn: noopRemove,
      retryDelayMs: 0,
    });
    expect(result).toBeNull();
  });

  it('returns null (indeterminate) when setup-worktree.cjs fails in baseline on every attempt', async () => {
    let removeCalled = 0;
    let setupCalls = 0;
    const result = await triageTestFailures('/fake/project', '/fake/work', ['a.test.ts'], {
      isTestFileFailingFn: async () => true,
      resolveBaseCommitFn: async () => 'abc1234',
      getMainRepoRootFn: async () => '/fake/main',
      createWorktreeFn: async () => true,
      setupWorktreeFn: async () => {
        setupCalls++;
        return false; // setup failed
      },
      removeWorktreeFn: async (_b, _p, _d) => {
        removeCalled++;
      },
      retryDelayMs: 0,
    });
    expect(result).toBeNull();
    // Task 659: one retry, then give up — and cleanup still runs exactly once.
    expect(setupCalls).toBe(2);
    expect(removeCalled).toBe(1);
  });

  it('recovers when the baseline worktree creation fails only on the first attempt (task 659)', async () => {
    const dirs: string[] = [];
    let removedDir: string | null = null;
    const result = await triageTestFailures('/fake/project', '/fake/work', ['a.test.ts'], {
      isTestFileFailingFn: async () => true,
      resolveBaseCommitFn: async () => 'abc1234',
      getMainRepoRootFn: async () => '/fake/main',
      createWorktreeFn: async (_root, dir) => {
        dirs.push(dir);
        return dirs.length >= 2;
      },
      setupWorktreeFn: async () => true,
      removeWorktreeFn: async (_b, p, _d) => {
        removedDir = p;
      },
      retryDelayMs: 0,
    });
    // Not null: the retry rescued the comparison. The file is absent from the
    // (fabricated) baseline path, so it classifies as new.
    expect(result).toEqual({ preExisting: [], newFailures: ['a.test.ts'] });
    expect(dirs).toHaveLength(2);
    expect(dirs[0]).not.toBe(dirs[1]);
    expect(removedDir).toBe(dirs[1]);
  });
});
