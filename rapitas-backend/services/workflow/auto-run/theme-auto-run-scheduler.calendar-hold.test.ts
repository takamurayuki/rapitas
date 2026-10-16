/**
 * theme-auto-run-scheduler.calendar-hold.test
 *
 * Task 1174: a current task stopped at its phase boundary by the calendar
 * (waiting for a meeting to end) must not be force-stopped by the hang
 * backstop — its tenure is measuring wait time. Once the hold has expired the
 * backstop works as before.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  ThemeAutoRunScheduler,
  internal,
  resetSchedulerSingleton,
  resetAllMocks,
  TEST_MAX_TASK_WALL_MS,
  mockIsAwaitingUserAnswer,
  mockHasLiveExecution,
  mockNotifyHangBackstop,
  mockOnTaskFailed,
  mockTaskUpdate,
  mockGetThemeActiveQueueItems,
} from './theme-auto-run-scheduler.test-support';
import {
  markTaskCalendarHold,
  resetCalendarHoldState,
} from '../../scheduling/calendar-slot/calendar-hold-state';

let scheduler: ThemeAutoRunScheduler;

function staleLastRunAt(): string {
  return new Date(Date.now() - TEST_MAX_TASK_WALL_MS - 500).toISOString();
}

beforeEach(() => {
  resetAllMocks();
  resetCalendarHoldState();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  mockGetThemeActiveQueueItems.mockResolvedValue([]);
  mockIsAwaitingUserAnswer.mockResolvedValue(false);
});

describe('advanceTheme — calendar phase-boundary hold exemption', () => {
  it('does not force-stop a task waiting at its checkpoint for a meeting to end', async () => {
    markTaskCalendarHold(100, new Date(Date.now() + 60 * 60_000));

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, staleLastRunAt());

    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
    expect(mockTaskUpdate).not.toHaveBeenCalled();
    expect(mockOnTaskFailed).not.toHaveBeenCalled();
    expect(mockHasLiveExecution).not.toHaveBeenCalled();
  });

  it('does not exempt a hold whose release time has passed', async () => {
    markTaskCalendarHold(100, new Date(Date.now() - 60_000));

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, staleLastRunAt());

    expect(mockHasLiveExecution).toHaveBeenCalled();
  });
});
