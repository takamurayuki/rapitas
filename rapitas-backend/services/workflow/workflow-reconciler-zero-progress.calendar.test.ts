/**
 * workflow-reconciler-zero-progress.calendar.test
 *
 * Task 1174: a running theme whose current task is stopped at a phase
 * boundary by the calendar runs no execution on purpose. The zero-progress
 * detector must log a quiet waiting event instead of alarming — but only
 * while the hold is in force; an expired hold alarms as before.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ZERO_PROGRESS_THRESHOLD_MS } from './queue-stall-policy';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const findByStatusesMock = mock(() =>
  Promise.resolve([{ themeId: 1, currentTaskId: 1200, status: 'running' }]),
);
const notifyMock = mock(() => Promise.resolve());
const logCycleEventMock = mock(() => {});

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: {
    agentExecution: { count: async () => 0, findFirst: async () => null },
    task: {
      findUnique: async () => ({ status: 'in-progress', workflowStatus: 'plan_approved' }),
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./auto-run/theme-auto-run-service', () => ({
  findByStatuses: findByStatusesMock,
}));
mock.module('./auto-run/queue-wait-exemption', () => ({
  liveOrQueuedBehind: () => Promise.resolve(false),
}));
mock.module('./auto-run/auto-run-notifications', () => ({
  notifyZeroProgressWhileRunning: notifyMock,
}));
mock.module('../observability', () => ({
  logCycleEvent: logCycleEventMock,
  getCycleLogFilePath: () => '/tmp/cycle.ndjson',
}));

const { detectZeroProgressWhileRunning, resetZeroProgressTracker } =
  await import('./workflow-reconciler-zero-progress');
const { markTaskCalendarHold, resetCalendarHoldState } =
  await import('../scheduling/calendar-slot/calendar-hold-state');

const NOW = 1_800_000_000_000;

beforeEach(() => {
  notifyMock.mockClear();
  logCycleEventMock.mockClear();
  resetZeroProgressTracker();
  resetCalendarHoldState();
});

describe('detectZeroProgressWhileRunning — calendar phase-boundary hold', () => {
  test('暦の会議待ちで保留中のタスクは警報せず静かなイベントに落とす', async () => {
    markTaskCalendarHold(1200, new Date(NOW + 2 * ZERO_PROGRESS_THRESHOLD_MS));

    await detectZeroProgressWhileRunning(NOW);
    expect(await detectZeroProgressWhileRunning(NOW + ZERO_PROGRESS_THRESHOLD_MS + 1_000)).toBe(0);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'theme.waiting_for_calendar_slot',
      expect.objectContaining({ theme: 1, task: 1200, ok: true }),
    );
  });

  test('解除予定時刻を過ぎた保留は免除せず従来どおり警報する', async () => {
    markTaskCalendarHold(1200, new Date(NOW - 60_000));

    await detectZeroProgressWhileRunning(NOW);
    expect(await detectZeroProgressWhileRunning(NOW + ZERO_PROGRESS_THRESHOLD_MS + 1_000)).toBe(1);
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });
});
