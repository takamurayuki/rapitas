/**
 * worktree-cleanup-scheduler.test.ts
 *
 * Proves the wiring of one cleanup cycle: the task-worktree cleanup, the idle
 * worktree sweep and the scratch-file sweep run, THEN the local branch prune
 * runs against the same root (#1403), and a failure in any one does not stop
 * the others or the scheduler.
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
let sweepFails = false;
const sweepIdleWorktrees = mock(async (baseDir: string) => {
  calls.push(`sweep:${baseDir}`);
  if (sweepFails) throw new Error('git missing');
  return { examined: 2, removed: ['/repo/.worktrees/old'], kept: [] };
});
const sweepScratchFiles = mock(async (baseDir: string) => {
  calls.push(`scratch:${baseDir}`);
  return { removed: ['.wf-1.json'] };
});
// Mirror every export of the barrel the scheduler imports.
mock.module('../agents/orchestrator/git-operations/branch-hygiene', () => ({
  pruneMergedLocalBranches,
  sweepIdleWorktrees,
  sweepScratchFiles,
  isWorkPreserved: mock(),
}));

const { WorktreeCleanupScheduler } = await import('./worktree-cleanup-scheduler');

beforeEach(() => {
  calls.length = 0;
  cleanupFails = false;
  sweepFails = false;
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
    expect(calls).toEqual(['cleanup:/repo', 'sweep:/repo', 'scratch:/repo', 'prune:/repo']);
  });

  test('defaults to the project root', async () => {
    await runFirstCycle();
    expect(calls).toEqual([
      'cleanup:/default-root',
      'sweep:/default-root',
      'scratch:/default-root',
      'prune:/default-root',
    ]);
  });

  test('a failed worktree sweep still lets the branch prune run', async () => {
    cleanupFails = true;
    await runFirstCycle('/repo');
    expect(calls).toEqual(['cleanup:/repo', 'sweep:/repo', 'scratch:/repo', 'prune:/repo']);
  });

  // Idle named worktrees (Codex, sub-agents, people) and scratch files were
  // never swept; the branch prune runs last so it sees the branches they freed.
  test('a failed idle-worktree sweep does not stop the rest of the cycle', async () => {
    sweepFails = true;
    await runFirstCycle('/repo');
    expect(calls).toEqual(['cleanup:/repo', 'sweep:/repo', 'scratch:/repo', 'prune:/repo']);
  });
});
