/**
 * auto-run-active-decision — the absolute ceiling counts from the last forward step
 *
 * The 3x ceiling used to be measured from when the theme selected the task, so a
 * large task that bounced through repairs was stopped even with a live execution
 * (tasks 1542, 1551, 1562 on 2026-11-26). The start now moves to the newest
 * verify_repair / question_resolved transition or execution start.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { prisma } from '../../../config/database';
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
} from './theme-auto-run-scheduler.test-support';

let scheduler: ThemeAutoRunScheduler;

/** Selected well past the 135-minute-equivalent ceiling (3x the wall). */
const selectedAt = () => new Date(Date.now() - TEST_MAX_TASK_WALL_MS * 4).toISOString();

/** Answers only the verify_repair / question_resolved lookup, as the real table would. */
function bounceAt(createdAt: Date | null) {
  mockResumeTransition.mockImplementation((async (args: {
    where: { cause?: { in?: string[] } };
  }) => (args.where.cause?.in?.includes('verify_repair') ? { createdAt } : null)) as never);
}

beforeEach(() => {
  resetAllMocks();
  resetSchedulerSingleton();
  scheduler = ThemeAutoRunScheduler.getInstance();
  mockGetThemeActiveQueueItems.mockResolvedValue([{ id: 1, taskId: 100, status: 'running' }]);
  mockIsAwaitingUserAnswer.mockResolvedValue(false);
  mockResumeTransition.mockReset().mockResolvedValue(null);
});

describe('hang backstop absolute ceiling (task 1563)', () => {
  it('does not stop a live task past the ceiling when it was sent back recently', async () => {
    bounceAt(new Date(Date.now() - TEST_MAX_TASK_WALL_MS / 4));
    mockHasLiveExecution.mockResolvedValue(true);
    mockResolveLastProgressAt.mockResolvedValue(Date.now() - TEST_MAX_TASK_WALL_MS / 4);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, selectedAt());

    expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
  });

  it('still stops a task that last moved forward more than the ceiling ago', async () => {
    bounceAt(new Date(Date.now() - TEST_MAX_TASK_WALL_MS * 3 - 500));
    mockHasLiveExecution.mockResolvedValue(true);
    mockResolveLastProgressAt.mockResolvedValue(Date.now() - TEST_MAX_TASK_WALL_MS * 3 - 500);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, selectedAt());

    expect(mockNotifyHangBackstop).toHaveBeenCalled();
  });

  it('still stops a task with no forward step and no heartbeat past the ceiling', async () => {
    bounceAt(null);
    mockHasLiveExecution.mockResolvedValue(false);
    mockResolveLastProgressAt.mockResolvedValue(Date.now() - TEST_MAX_TASK_WALL_MS * 4);

    await internal(scheduler).advanceTheme(1, 100, 'priority', 1, selectedAt());

    expect(mockNotifyHangBackstop).toHaveBeenCalled();
  });

  describe('newest AgentExecution start', () => {
    // The shared prisma mock has no agentExecution.findFirst; install one per test.
    const exec = prisma as unknown as { agentExecution: Record<string, unknown> };
    afterEach(() => {
      delete exec.agentExecution.findFirst;
    });

    it('does not stop a live task past the ceiling when a new run started recently', async () => {
      exec.agentExecution.findFirst = mock(async () => ({
        startedAt: new Date(Date.now() - TEST_MAX_TASK_WALL_MS / 4),
      }));
      bounceAt(null);
      mockHasLiveExecution.mockResolvedValue(true);
      mockResolveLastProgressAt.mockResolvedValue(Date.now() - TEST_MAX_TASK_WALL_MS / 4);

      await internal(scheduler).advanceTheme(1, 100, 'priority', 1, selectedAt());

      expect(mockNotifyHangBackstop).not.toHaveBeenCalled();
    });

    it('still stops when the newest run started more than the ceiling ago', async () => {
      exec.agentExecution.findFirst = mock(async () => ({
        startedAt: new Date(Date.now() - TEST_MAX_TASK_WALL_MS * 3 - 500),
      }));
      bounceAt(null);
      mockHasLiveExecution.mockResolvedValue(true);
      mockResolveLastProgressAt.mockResolvedValue(Date.now() - TEST_MAX_TASK_WALL_MS * 3 - 500);

      await internal(scheduler).advanceTheme(1, 100, 'priority', 1, selectedAt());

      expect(mockNotifyHangBackstop).toHaveBeenCalled();
    });
  });
});
