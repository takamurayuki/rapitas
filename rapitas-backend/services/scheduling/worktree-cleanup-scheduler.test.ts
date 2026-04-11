// @ts-nocheck — Uses vitest API in a bun:test project. Needs migration.
/**
 * Tests for WorktreeCleanupScheduler
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WorktreeCleanupScheduler,
  getWorktreeCleanupScheduler,
} from './worktree-cleanup-scheduler';

// Mock modules
vi.mock('../agents/orchestrator/git-operations/worktree-ops', () => ({
  cleanupOrphanedWorktrees: vi.fn(),
}));

vi.mock('../../config', () => ({
  getProjectRoot: vi.fn(() => '/test/project'),
}));

const { cleanupOrphanedWorktrees } =
  await import('../agents/orchestrator/git-operations/worktree-ops');
const mockCleanupOrphanedWorktrees = vi.mocked(cleanupOrphanedWorktrees);

describe('WorktreeCleanupScheduler', () => {
  let scheduler: WorktreeCleanupScheduler;

  beforeEach(() => {
    scheduler = new WorktreeCleanupScheduler();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    scheduler.stop();
    vi.useRealTimers();
  });

  it('should start and run initial cleanup immediately', async () => {
    mockCleanupOrphanedWorktrees.mockResolvedValue(2);

    scheduler.start(5000, '/test/repo'); // 5 second interval

    expect(scheduler.getIsRunning()).toBe(true);

    // Wait for initial cleanup to be called
    await vi.runOnlyPendingTimersAsync();

    expect(mockCleanupOrphanedWorktrees).toHaveBeenCalledWith('/test/repo');
    expect(mockCleanupOrphanedWorktrees).toHaveBeenCalledTimes(1);
  });

  it('should run periodic cleanup at specified intervals', async () => {
    mockCleanupOrphanedWorktrees.mockResolvedValue(1);

    scheduler.start(1000, '/test/repo'); // 1 second interval

    // Initial cleanup
    await vi.runOnlyPendingTimersAsync();
    expect(mockCleanupOrphanedWorktrees).toHaveBeenCalledTimes(1);

    // First periodic cleanup
    vi.advanceTimersByTime(1000);
    await vi.runOnlyPendingTimersAsync();
    expect(mockCleanupOrphanedWorktrees).toHaveBeenCalledTimes(2);

    // Second periodic cleanup
    vi.advanceTimersByTime(1000);
    await vi.runOnlyPendingTimersAsync();
    expect(mockCleanupOrphanedWorktrees).toHaveBeenCalledTimes(3);
  });

  it('should use default interval and project root when not specified', async () => {
    mockCleanupOrphanedWorktrees.mockResolvedValue(0);

    scheduler.start(); // Use defaults

    await vi.runOnlyPendingTimersAsync();

    expect(mockCleanupOrphanedWorktrees).toHaveBeenCalledWith('/test/project');
    expect(scheduler.getIsRunning()).toBe(true);
  });

  it('should stop scheduler and clear interval', () => {
    scheduler.start(5000);
    expect(scheduler.getIsRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.getIsRunning()).toBe(false);
  });

  it('should ignore start request if already running', () => {
    scheduler.start(5000);
    expect(scheduler.getIsRunning()).toBe(true);

    // Try to start again
    scheduler.start(3000);
    expect(scheduler.getIsRunning()).toBe(true);
  });

  it('should ignore stop request if not running', () => {
    expect(scheduler.getIsRunning()).toBe(false);

    scheduler.stop(); // Should not throw
    expect(scheduler.getIsRunning()).toBe(false);
  });

  it('should handle cleanup errors gracefully', async () => {
    mockCleanupOrphanedWorktrees.mockRejectedValue(new Error('Cleanup failed'));

    scheduler.start(5000);

    // Should not throw despite cleanup error
    await vi.runOnlyPendingTimersAsync();

    expect(scheduler.getIsRunning()).toBe(true);
    expect(mockCleanupOrphanedWorktrees).toHaveBeenCalledTimes(1);
  });

  it('should continue running after cleanup errors', async () => {
    mockCleanupOrphanedWorktrees
      .mockRejectedValueOnce(new Error('First cleanup failed'))
      .mockResolvedValueOnce(1);

    scheduler.start(1000);

    // Initial cleanup fails
    await vi.runOnlyPendingTimersAsync();
    expect(mockCleanupOrphanedWorktrees).toHaveBeenCalledTimes(1);

    // Next cleanup should still run
    vi.advanceTimersByTime(1000);
    await vi.runOnlyPendingTimersAsync();
    expect(mockCleanupOrphanedWorktrees).toHaveBeenCalledTimes(2);

    expect(scheduler.getIsRunning()).toBe(true);
  });
});

describe('Global scheduler functions', () => {
  afterEach(() => {
    const globalScheduler = getWorktreeCleanupScheduler();
    globalScheduler.stop();
  });

  it('should return the same scheduler instance', () => {
    const scheduler1 = getWorktreeCleanupScheduler();
    const scheduler2 = getWorktreeCleanupScheduler();

    expect(scheduler1).toBe(scheduler2);
  });

  it('should start the global scheduler', () => {
    const globalScheduler = getWorktreeCleanupScheduler();
    const startSpy = vi.spyOn(globalScheduler, 'start');

    // Import function to avoid module mocking issues
    const { startWorktreeCleanupScheduler } = require('./worktree-cleanup-scheduler');

    startWorktreeCleanupScheduler(5000, '/test/repo');

    expect(startSpy).toHaveBeenCalledWith(5000, '/test/repo');
  });

  it('should stop the global scheduler', () => {
    const globalScheduler = getWorktreeCleanupScheduler();
    const stopSpy = vi.spyOn(globalScheduler, 'stop');

    // Import function to avoid module mocking issues
    const { stopWorktreeCleanupScheduler } = require('./worktree-cleanup-scheduler');

    stopWorktreeCleanupScheduler();

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
