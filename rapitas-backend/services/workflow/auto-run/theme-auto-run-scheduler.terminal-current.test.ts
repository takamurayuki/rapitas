import {
  mockStopTaskTreeAgents,
  mockResumeTransition,
} from './theme-auto-run-scheduler.test-support.collaborator-mocks';
/**
 * theme-auto-run-scheduler.terminal-current.test
 *
 * Task 1009: a CANCELLED current task must be released and the scheduler must
 * advance to selection — never re-enqueue it (the 12s enqueue/stall-release spin).
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  mockGetThemeActiveQueueItems,
  mockQueueItemFindFirst,
  mockResolveTaskWorkflowState,
  mockEnqueue,
  mockSetCurrentTask,
  mockOnTaskCompleted,
  mockSelectNextTask,
  mockLogCycleEvent,
  mockReleaseStaleActiveItems,
} from './theme-auto-run-scheduler.test-support';

let scheduler: ThemeAutoRunScheduler;

beforeEach(() => {
  resetAllMocks();
  mockResumeTransition.mockReset().mockResolvedValue(null);
  mockStopTaskTreeAgents.mockClear();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  mockGetThemeActiveQueueItems.mockResolvedValue([]);
  mockQueueItemFindFirst.mockResolvedValue(null);
});

describe('advanceTheme — cancelled current task (task 1009)', () => {
  it('releases it and goes to selection over 3 ticks without ever re-enqueueing', async () => {
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 1008,
      status: 'cancelled',
      workflowStatus: null,
      workflowMode: null,
      parentId: null,
    });

    for (let tick = 0; tick < 3; tick++) {
      await internal(scheduler).advanceTheme(1, 1008, 'priority', 0, new Date().toISOString());
    }

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockOnTaskCompleted).not.toHaveBeenCalled();
    expect(mockSelectNextTask).toHaveBeenCalled();
    expect(mockLogCycleEvent).toHaveBeenCalledWith(
      'task.skipped',
      expect.objectContaining({ cause: 'terminal_current_released', task: 1008 }),
    );
    expect(mockSetCurrentTask).not.toHaveBeenCalledWith(1, 1008);
  });

  it('still re-enqueues a non-terminal task whose queue item vanished', async () => {
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 100,
      status: 'in-progress',
      workflowStatus: 'in_progress',
      workflowMode: null,
      parentId: null,
    });

    await internal(scheduler).advanceTheme(1, 100, 'priority', 0, new Date().toISOString());

    expect(mockEnqueue).toHaveBeenCalledWith({ taskId: 100, themeId: 1, priority: 50 });
  });

  it('keeps the completed path for a done task (onTaskCompleted, not the cancelled release)', async () => {
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 100,
      status: 'done',
      workflowStatus: 'completed',
      workflowMode: null,
      parentId: null,
    });

    await internal(scheduler).advanceTheme(1, 100, 'priority', 0, new Date().toISOString());

    expect(mockOnTaskCompleted).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('residue-cleanup tick (active item released) on a cancelled task falls through to release + selection, no enqueue', async () => {
    mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 5, taskId: 1008, status: 'queued' }]);
    mockReleaseStaleActiveItems.mockResolvedValue(1);
    mockResolveTaskWorkflowState.mockResolvedValue({
      id: 1008,
      status: 'cancelled',
      workflowStatus: null,
      workflowMode: null,
      parentId: null,
    });

    await internal(scheduler).advanceTheme(1, 1008, 'priority', 0, new Date().toISOString());

    expect(mockReleaseStaleActiveItems).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockSelectNextTask).toHaveBeenCalled();
    expect(mockLogCycleEvent).toHaveBeenCalledWith(
      'task.skipped',
      expect.objectContaining({ cause: 'terminal_current_released' }),
    );
  });

  it('task turning done between the snapshot and the re-enqueue is completed, not re-enqueued', async () => {
    const live = {
      id: 100,
      status: 'in-progress',
      workflowStatus: 'in_progress',
      workflowMode: null,
      parentId: null,
    };
    const done = { ...live, status: 'done', workflowStatus: 'completed' };
    mockResolveTaskWorkflowState.mockResolvedValueOnce(live).mockResolvedValue(done);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 0, new Date().toISOString());

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockOnTaskCompleted).toHaveBeenCalledTimes(1);
    expect(mockSelectNextTask).toHaveBeenCalled();
  });
});
