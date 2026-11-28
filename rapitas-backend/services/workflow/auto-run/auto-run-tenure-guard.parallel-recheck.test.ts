/**
 * auto-run-tenure-guard — the parallel re-check hold (task 1572)
 *
 * A companion waiting at the implementer re-check for a running task to leave
 * is not hung: past the tenure wall it must not be force-stopped (blocked).
 * A hold with no opponent (missing files) is not exempt. Once the gate lets it
 * through, the `parallel_recheck_passed` row moves the 3x ceiling's start (the
 * real resume-tenure.ts), so the implementer is not stopped right after.
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
  mockResolveLastProgressAt,
  mockNotifyHangBackstop,
  mockGetThemeActiveQueueItems,
  mockResumeTransition,
  mockBackendBootAt,
} from './theme-auto-run-scheduler.test-support';
import { setRecheckHold, resetRecheckHoldState } from './parallel/recheck/recheck-state';

let scheduler: ThemeAutoRunScheduler;

/** Selected well past the 3x ceiling. */
const selectedAt = () => new Date(Date.now() - TEST_MAX_TASK_WALL_MS * 4).toISOString();

beforeEach(() => {
  resetAllMocks();
  resetSchedulerSingleton();
  resetRecheckHoldState();
  scheduler = ThemeAutoRunScheduler.getInstance();
  mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 1, taskId: 100, status: 'running' }]);
  mockIsAwaitingUserAnswer.mockResolvedValue(false);
  mockHasLiveExecution.mockResolvedValue(false);
  mockResolveLastProgressAt.mockResolvedValue(Date.now() - TEST_MAX_TASK_WALL_MS * 4);
  mockResumeTransition.mockReset().mockResolvedValue(null);
});

describe('hang backstop and the parallel re-check hold (task 1572)', () => {
  it('control: the same task with no hold is force-stopped', async () => {
    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, selectedAt());
    expect(mockNotifyHangBackstop).toHaveBeenCalled();
  });

  it('does not stop a task waiting on another task at the re-check', async () => {
    setRecheckHold(100, true, Date.now() - TEST_MAX_TASK_WALL_MS * 4);
    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, selectedAt());
    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
  });

  it('still stops a hold with no opponent (candidate files missing)', async () => {
    setRecheckHold(100, false, Date.now() - TEST_MAX_TASK_WALL_MS * 4);
    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, selectedAt());
    expect(mockNotifyHangBackstop).toHaveBeenCalled();
  });

  it('does not stop the implementer right after the re-check passed', async () => {
    const passedAt = new Date(Date.now() - TEST_MAX_TASK_WALL_MS / 4);
    // Answers only the progress lookup that names the passed cause, as the table would.
    mockResumeTransition.mockImplementation((async (args: {
      where: { cause?: { in?: string[] } };
    }) =>
      args.where.cause?.in?.includes('parallel_recheck_passed')
        ? { createdAt: passedAt }
        : null) as never);
    mockHasLiveExecution.mockResolvedValue(true);
    mockResolveLastProgressAt.mockResolvedValue(passedAt.getTime());
    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, selectedAt());
    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
  });

  it('an emptied hold table after a restart does not stop the task (boot clamp)', async () => {
    mockBackendBootAt.mockReturnValue(Date.now() - TEST_MAX_TASK_WALL_MS / 2);
    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, selectedAt());
    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
  });
});
