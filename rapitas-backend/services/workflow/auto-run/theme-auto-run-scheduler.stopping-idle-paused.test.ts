/**
 * theme-auto-run-scheduler.stopping-idle-paused.test
 *
 * Covers processStoppingThemes(), processIdleThemes(), processPausedThemes(),
 * stopThemeExecution(), and broadcastAutoRunUpdate() — the per-bucket private
 * handlers invoked by tick().
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  makeState,
  mockQueueItemUpdateMany,
  mockFinalizeStop,
  mockBroadcast,
  mockResolveTaskWorkingDirectory,
  mockStopThemeAgents,
  mockRevertChanges,
  mockTaskUpdate,
  mockTaskCount,
  mockHasPromotableBacklog,
  mockStartAutoRun,
  mockGetThemeActiveQueueItems,
  mockQueueItemFindFirst,
  mockResumeAutoRun,
} from './theme-auto-run-scheduler.test-support';

let scheduler: ThemeAutoRunScheduler;

beforeEach(() => {
  resetAllMocks();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
});

describe('processStoppingThemes', () => {
  it('does nothing for an empty list', async () => {
    await internal(scheduler).processStoppingThemes([]);
    expect(mockFinalizeStop).not.toHaveBeenCalled();
  });

  it('cancels queue items, finalizes, and broadcasts for each stopping theme', async () => {
    const states = [
      makeState({ themeId: 10, status: 'stopping', currentTaskId: 100 }),
      makeState({ themeId: 20, status: 'stopping', currentTaskId: null }),
    ];

    await internal(scheduler).processStoppingThemes(states);

    expect(mockQueueItemUpdateMany).toHaveBeenCalledTimes(2);
    expect(mockFinalizeStop).toHaveBeenCalledWith(10);
    expect(mockFinalizeStop).toHaveBeenCalledWith(20);
    expect(mockBroadcast).toHaveBeenCalledTimes(2);
  });

  it('an error stopping ONE theme does not block the others in the batch', async () => {
    mockQueueItemUpdateMany.mockImplementationOnce(() => Promise.reject(new Error('db down')));
    const states = [
      makeState({ themeId: 10, status: 'stopping' }),
      makeState({ themeId: 20, status: 'stopping' }),
    ];

    await internal(scheduler).processStoppingThemes(states);

    // Theme 10's stopThemeExecution failed (updateMany rejected), so it never
    // reaches finalizeStop; theme 20 must still complete normally.
    expect(mockFinalizeStop).not.toHaveBeenCalledWith(10);
    expect(mockFinalizeStop).toHaveBeenCalledWith(20);
  });
});

describe('processIdleThemes', () => {
  it('skips a user-stopped (enabled:false) theme entirely', async () => {
    await internal(scheduler).processIdleThemes([makeState({ enabled: false })]);
    expect(mockTaskCount).not.toHaveBeenCalled();
    expect(mockStartAutoRun).not.toHaveBeenCalled();
  });

  it('stays idle when there is no todo task and no promotable backlog', async () => {
    mockTaskCount.mockResolvedValue(0);
    mockHasPromotableBacklog.mockResolvedValue(false);

    await internal(scheduler).processIdleThemes([makeState({ enabled: true, themeId: 7 })]);

    expect(mockStartAutoRun).not.toHaveBeenCalled();
  });

  it('resumes on a fresh todo task WITHOUT even checking the backlog (short-circuit)', async () => {
    mockTaskCount.mockResolvedValue(1);

    await internal(scheduler).processIdleThemes([makeState({ enabled: true, themeId: 7 })]);

    expect(mockStartAutoRun).toHaveBeenCalledWith(7);
    expect(mockHasPromotableBacklog).not.toHaveBeenCalled();
  });

  it('resumes when no todo task exists but the backlog has a promotable item', async () => {
    mockTaskCount.mockResolvedValue(0);
    mockHasPromotableBacklog.mockResolvedValue(true);

    await internal(scheduler).processIdleThemes([makeState({ enabled: true, themeId: 7 })]);

    expect(mockStartAutoRun).toHaveBeenCalledWith(7);
  });

  it('a rejection while checking one theme does not stop the next theme in the batch', async () => {
    mockTaskCount
      .mockImplementationOnce(() => Promise.reject(new Error('db down')))
      .mockImplementationOnce(() => Promise.resolve(0));
    mockHasPromotableBacklog.mockImplementation((themeId: number) =>
      // task.count itself is defensively .catch(() => 0)'d inside the scheduler,
      // so make the FAILURE surface via hasPromotableBacklog instead for theme 1.
      themeId === 1 ? Promise.reject(new Error('backlog check failed')) : Promise.resolve(true),
    );

    await internal(scheduler).processIdleThemes([
      makeState({ enabled: true, themeId: 1 }),
      makeState({ enabled: true, themeId: 2 }),
    ]);

    expect(mockStartAutoRun).not.toHaveBeenCalledWith(1);
    expect(mockStartAutoRun).toHaveBeenCalledWith(2);
  });
});

describe('processPausedThemes', () => {
  it('skips a paused theme with no currentTaskId', async () => {
    await internal(scheduler).processPausedThemes([
      makeState({ status: 'paused', currentTaskId: null }),
    ]);
    expect(mockGetThemeActiveQueueItems).not.toHaveBeenCalled();
  });

  it('leaves the theme paused while a queue item is still waiting_approval', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([
      { id: 1, taskId: 5, status: 'waiting_approval' },
    ]);

    await internal(scheduler).processPausedThemes([
      makeState({ status: 'paused', currentTaskId: 5, themeId: 9 }),
    ]);

    expect(mockQueueItemFindFirst).not.toHaveBeenCalled();
    expect(mockResumeAutoRun).not.toHaveBeenCalled();
  });

  it('does not resume when the item is gone AND no queued re-entry exists', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([]);
    mockQueueItemFindFirst.mockResolvedValue(null);

    await internal(scheduler).processPausedThemes([
      makeState({ status: 'paused', currentTaskId: 5, themeId: 9 }),
    ]);

    expect(mockResumeAutoRun).not.toHaveBeenCalled();
  });

  it('auto-resumes once the plan was approved (item re-queued)', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([]);
    mockQueueItemFindFirst.mockResolvedValue({ id: 1, status: 'queued', errorMessage: null });

    await internal(scheduler).processPausedThemes([
      makeState({ status: 'paused', currentTaskId: 5, themeId: 9 }),
    ]);

    expect(mockResumeAutoRun).toHaveBeenCalledWith(9);
    expect(mockBroadcast).toHaveBeenCalled();
  });

  it('swallows an error from getThemeActiveQueueItems without throwing', async () => {
    mockGetThemeActiveQueueItems.mockImplementation(() => Promise.reject(new Error('db down')));

    await expect(
      internal(scheduler).processPausedThemes([makeState({ status: 'paused', currentTaskId: 5 })]),
    ).resolves.toBeUndefined();
  });
});

describe('stopThemeExecution', () => {
  it('always cancels active queue items for the theme', async () => {
    await internal(scheduler).stopThemeExecution(10, null);
    expect(mockQueueItemUpdateMany).toHaveBeenCalledWith({
      where: { themeId: 10, status: { in: ['queued', 'running', 'waiting_approval'] } },
      data: {
        status: 'cancelled',
        completedAt: expect.any(Date),
        errorMessage: 'Auto-run stopped',
      },
    });
  });

  it('does nothing further when there is no current task', async () => {
    await internal(scheduler).stopThemeExecution(10, null);
    expect(mockResolveTaskWorkingDirectory).not.toHaveBeenCalled();
    expect(mockStopThemeAgents).not.toHaveBeenCalled();
  });

  it('kills theme agents, reverts a resolved working directory, and resets the task to todo', async () => {
    mockResolveTaskWorkingDirectory.mockResolvedValue({
      themeId: 10,
      workingDirectory: '/repo/work',
      theme: null,
    });

    await internal(scheduler).stopThemeExecution(10, 100);

    expect(mockStopThemeAgents).toHaveBeenCalledWith(10, 100, { errorMessage: 'Auto-run stopped' });
    expect(mockRevertChanges).toHaveBeenCalledWith('/repo/work');
    expect(mockTaskUpdate).toHaveBeenCalledWith({ where: { id: 100 }, data: { status: 'todo' } });
  });

  it('falls back to the theme working directory when the task has none of its own', async () => {
    mockResolveTaskWorkingDirectory.mockResolvedValue({
      themeId: 10,
      workingDirectory: null,
      theme: { workingDirectory: '/repo/theme-dir' },
    });

    await internal(scheduler).stopThemeExecution(10, 100);

    expect(mockRevertChanges).toHaveBeenCalledWith('/repo/theme-dir');
  });

  it('skips revertChanges entirely when no working directory can be resolved', async () => {
    mockResolveTaskWorkingDirectory.mockResolvedValue({
      themeId: 10,
      workingDirectory: null,
      theme: null,
    });

    await internal(scheduler).stopThemeExecution(10, 100);

    expect(mockRevertChanges).not.toHaveBeenCalled();
    // The task must still be reset even without a working directory to revert.
    expect(mockTaskUpdate).toHaveBeenCalledWith({ where: { id: 100 }, data: { status: 'todo' } });
  });

  it('swallows an unexpected resolveTaskWorkingDirectory throw without propagating', async () => {
    mockResolveTaskWorkingDirectory.mockImplementation(() => Promise.reject(new Error('boom')));

    await expect(internal(scheduler).stopThemeExecution(10, 100)).resolves.toBeUndefined();
  });
});

describe('broadcastAutoRunUpdate', () => {
  it('broadcasts on the orchestra channel', () => {
    internal(scheduler).broadcastAutoRunUpdate(55);
    expect(mockBroadcast).toHaveBeenCalledWith(
      'orchestra',
      'auto_run_update',
      expect.objectContaining({ themeId: 55 }),
    );
  });

  it('never throws even when the realtime service itself throws (SSE unavailable)', () => {
    mockBroadcast.mockImplementationOnce(() => {
      throw new Error('SSE down');
    });
    expect(() => internal(scheduler).broadcastAutoRunUpdate(55)).not.toThrow();
  });
});
