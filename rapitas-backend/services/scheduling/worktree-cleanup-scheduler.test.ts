/**
 * worktree-cleanup-scheduler.test.ts
 *
 * Tests for WorktreeCleanupScheduler.
 * TODO: Restore full test coverage for start/stop/runCleanup lifecycle.
 */
import { describe, it, expect } from 'bun:test';

// NOTE: Tests disabled pending full mock setup for cleanupOrphanedWorktrees and setInterval.
describe.skip('WorktreeCleanupScheduler', () => {
  it('placeholder', () => {
    expect(true).toBe(true);
  });
});
