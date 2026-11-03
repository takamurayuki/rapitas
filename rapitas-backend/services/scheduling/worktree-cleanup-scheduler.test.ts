/**
 * worktree-cleanup-scheduler.test.ts
 *
 * Proves the wiring of one cleanup cycle: the worktree sweep runs, THEN the
 * local branch prune runs against the same root (#1403), and a failure in
 * either does not stop the other or the scheduler.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../config', () => ({ getProjectRoot: () => '/default-root' }));

const calls: string[] = [];
let cleanupFails = false;
const cleanupOrphanedWorktrees = mock(async (baseDir: string) => {
  calls.push(`cleanup:${baseDir}`);
  if (cleanupFails) throw new Error('db down');
  return 0;
});
// Mirror every export of the barrel.
mock.module('../agents/orchestrator/git-operations/worktree/worktree-ops', () => ({
  ensureGitRepository: mock(),
  validateAndSetupRemote: mock(),
  rmDirWithRetry: mock(),
  createWorktree: mock(),
  removeWorktree: mock(),
  cleanupStaleWorktrees: mock(),
  cleanupOrphanedWorktrees,
}));

let pruneDone: () => void = () => {};
const pruneMergedLocalBranches = mock(async (baseDir: string) => {
  calls.push(`prune:${baseDir}`);
  pruneDone();
  return { examined: 3, deleted: ['feature/x'], kept: 2 };
});
mock.module('../agents/orchestrator/git-operations/branch-hygiene', () => ({
  pruneMergedLocalBranches,
}));

const { WorktreeCleanupScheduler } = await import('./worktree-cleanup-scheduler');

beforeEach(() => {
  calls.length = 0;
  cleanupFails = false;
  cleanupOrphanedWorktrees.mockClear();
  pruneMergedLocalBranches.mockClear();
});

/** Start a scheduler and resolve once its immediate first cycle reached the prune. */
async function runFirstCycle(baseDir?: string): Promise<void> {
  const reached = new Promise<void>((resolve) => {
    pruneDone = resolve;
  });
  const scheduler = new WorktreeCleanupScheduler();
  scheduler.start(60 * 60 * 1000, baseDir);
  await reached;
  scheduler.stop();
}

describe('WorktreeCleanupScheduler cycle', () => {
  test('prunes local branches after the worktree sweep, on the same root', async () => {
    await runFirstCycle('/repo');
    expect(calls).toEqual(['cleanup:/repo', 'prune:/repo']);
  });

  test('defaults to the project root', async () => {
    await runFirstCycle();
    expect(calls).toEqual(['cleanup:/default-root', 'prune:/default-root']);
  });

  test('a failed worktree sweep still lets the branch prune run', async () => {
    cleanupFails = true;
    await runFirstCycle('/repo');
    expect(calls).toEqual(['cleanup:/repo', 'prune:/repo']);
  });
});
