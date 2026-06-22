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

  it('returns null when merge-base cannot be resolved (fail-safe)', async () => {
    const result = await triageTestFailures('/fake/project', '/fake/work', ['a.test.ts'], {
      isTestFileFailingFn: async () => true,
      resolveBaseCommitFn: async () => null, // infrastructure failure
      getMainRepoRootFn: async () => '/fake/main',
      createWorktreeFn: async () => true,
      setupWorktreeFn: async () => true,
      removeWorktreeFn: noopRemove,
    });
    expect(result).toBeNull();
  });

  it('returns null when main repo root cannot be resolved (fail-safe)', async () => {
    const result = await triageTestFailures('/fake/project', '/fake/work', ['a.test.ts'], {
      isTestFileFailingFn: async () => true,
      resolveBaseCommitFn: async () => 'abc1234',
      getMainRepoRootFn: async () => null, // infrastructure failure
      createWorktreeFn: async () => true,
      setupWorktreeFn: async () => true,
      removeWorktreeFn: noopRemove,
    });
    expect(result).toBeNull();
  });

  it('returns null when baseline worktree creation fails (fail-safe)', async () => {
    const result = await triageTestFailures('/fake/project', '/fake/work', ['a.test.ts'], {
      isTestFileFailingFn: async () => true,
      resolveBaseCommitFn: async () => 'abc1234',
      getMainRepoRootFn: async () => '/fake/main',
      createWorktreeFn: async () => false, // git worktree add failed
      setupWorktreeFn: async () => true,
      removeWorktreeFn: noopRemove,
    });
    expect(result).toBeNull();
  });

  it('returns null when setup-worktree.cjs fails in baseline (fail-safe)', async () => {
    let removeCalled = false;
    const result = await triageTestFailures('/fake/project', '/fake/work', ['a.test.ts'], {
      isTestFileFailingFn: async () => true,
      resolveBaseCommitFn: async () => 'abc1234',
      getMainRepoRootFn: async () => '/fake/main',
      createWorktreeFn: async () => true,
      setupWorktreeFn: async () => false, // setup failed
      removeWorktreeFn: async (_b, _p, _d) => {
        removeCalled = true;
      },
    });
    expect(result).toBeNull();
    // Ensure cleanup still ran even though setup failed
    expect(removeCalled).toBe(true);
  });
});
