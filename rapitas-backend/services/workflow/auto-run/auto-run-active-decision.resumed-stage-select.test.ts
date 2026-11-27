/**
 * auto-run-active-decision — selection keeps a resumed blocked-retry stage (task 1563)
 *
 * The blocked auto-retry now stores `todo` + plan_approved / in_progress. Selection
 * resets only verify_done / completed to draft (stale_terminal_reset), so those
 * stages survive; verify_done must therefore never be stored as `todo` — the retry
 * parks it as in-progress through holdForRequiredMerge instead.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  mockSelectNextTask,
  mockTaskFindUnique,
  mockTaskUpdate,
  mockEnqueue,
  mockRecordTransition,
} from './theme-auto-run-scheduler.test-support';

let scheduler: ThemeAutoRunScheduler;

beforeEach(() => {
  resetAllMocks();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
});

describe('selection of a task resumed by the blocked auto-retry', () => {
  it.each(['plan_created', 'plan_approved', 'in_progress'])(
    'keeps workflowStatus %s: no stale_terminal_reset, the task is enqueued as-is',
    async (stage) => {
      mockSelectNextTask.mockResolvedValue({ found: true, taskId: 1563 });
      mockTaskFindUnique.mockResolvedValue({ workflowStatus: stage });

      await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

      expect(mockTaskUpdate).not.toHaveBeenCalled();
      expect(mockRecordTransition).not.toHaveBeenCalled();
      expect(mockEnqueue).toHaveBeenCalledWith({ taskId: 1563, themeId: 1, priority: 50 });
    },
  );

  it('would reset a todo + verify_done task to draft — why the retry never stores that shape', async () => {
    mockSelectNextTask.mockResolvedValue({ found: true, taskId: 1563 });
    mockTaskFindUnique.mockResolvedValue({ workflowStatus: 'verify_done' });

    await internal(scheduler).advanceTheme(1, null, 'priority', 0, null);

    expect(mockTaskUpdate).toHaveBeenCalledWith({
      where: { id: 1563 },
      data: { workflowStatus: 'draft' },
    });
  });
});
