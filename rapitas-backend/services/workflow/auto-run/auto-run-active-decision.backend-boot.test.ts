/**
 * auto-run-active-decision — backend downtime is not hang time
 *
 * The wall-clock backstop must measure only time this backend was alive.
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
  mockBackendBootAt,
} from './theme-auto-run-scheduler.test-support';
import { clampToBackendBoot } from './resume-tenure';

let scheduler: ThemeAutoRunScheduler;

/** Became current, and last progressed, well before the backstop wall. */
const longAgo = () => Date.now() - TEST_MAX_TASK_WALL_MS * 10;

beforeEach(() => {
  resetAllMocks();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  mockGetThemeActiveQueueItems.mockResolvedValue([]);
  mockIsAwaitingUserAnswer.mockResolvedValue(false);
  mockHasLiveExecution.mockResolvedValue(false);
});

// 2026-11-23 06:05: the backend came back after ~6 h down (a ghost socket held
// port 3001). TempoRaid task 1307's last progress was before the outage, so
// the very first tick after the restart counted the outage as a hang, fired
// auto_run_hang_backstop and blocked it; the blocked auto-retry then reset the
// finished implementation to draft.
describe('hang backstop across a backend restart', () => {
  it('does not fire when the stale progress predates this backend boot', async () => {
    mockBackendBootAt.mockReturnValue(Date.now() - 50); // just restarted
    mockResolveLastProgressAt.mockResolvedValue(longAgo());

    await internal(scheduler).advanceTheme(
      1,
      100,
      'priority',
      1,
      new Date(longAgo()).toISOString(),
    );

    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
  });

  it('still fires once the task has made no progress for a full wall since boot', async () => {
    mockBackendBootAt.mockReturnValue(Date.now() - TEST_MAX_TASK_WALL_MS - 500);
    mockResolveLastProgressAt.mockResolvedValue(longAgo());

    await internal(scheduler).advanceTheme(
      1,
      100,
      'priority',
      1,
      new Date(longAgo()).toISOString(),
    );

    expect(mockNotifyHangBackstop).toHaveBeenCalled();
  });
});

describe('clampToBackendBoot', () => {
  it('moves a start before the boot up to the boot, and leaves a later start alone', () => {
    expect(clampToBackendBoot(100, 500)).toBe(500);
    expect(clampToBackendBoot(900, 500)).toBe(900);
  });
});
