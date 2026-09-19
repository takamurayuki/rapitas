/**
 * self-incident-watcher.theme-busy-gate.test
 *
 * Watcher-level integration coverage for the theme-run-state gate (task
 * #969): a task waiting on a theme that is actively dispatching a DIFFERENT
 * task must not be filed as a stagnation/desync concern. Uses the same
 * mocked-prisma harness as self-incident-watcher.theme-auto-run-gate.test.ts.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const taskFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const taskFindUniqueMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const transitionFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const transitionFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const sessionFindFirstMock = mock(() => Promise.resolve<unknown>(null));
const executionFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const queueItemFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const notificationFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const prFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const activityLogFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const workflowFileFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const themeAutoRunFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const themeFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const userSettingsFindFirstMock = mock(() => Promise.resolve<unknown>(null));
const submitConcernMock = mock((_input: unknown) => Promise.resolve(1));
const notifyIntakeQuestionPendingMock = mock((_input: unknown) =>
  Promise.resolve<unknown>({ id: 1 }),
);

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: {
    task: { findMany: taskFindManyMock, findUnique: taskFindUniqueMock },
    workflowTransition: { findMany: transitionFindManyMock, findFirst: transitionFindFirstMock },
    agentSession: { findFirst: sessionFindFirstMock },
    agentExecution: { findFirst: executionFindFirstMock },
    workflowQueueItem: { findFirst: queueItemFindFirstMock },
    notification: { findFirst: notificationFindFirstMock },
    gitHubPullRequest: { findFirst: prFindFirstMock },
    activityLog: { findFirst: activityLogFindFirstMock },
    workflowFile: { findFirst: workflowFileFindFirstMock },
    themeAutoRun: { findMany: themeAutoRunFindManyMock },
    theme: { findMany: themeFindManyMock },
    userSettings: { findFirst: userSettingsFindFirstMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../memory/concern-backlog-service', () => ({
  submitConcern: submitConcernMock,
}));
mock.module('../communication/notification-service', () => ({
  notifyIntakeQuestionPending: notifyIntakeQuestionPendingMock,
}));

const { runSelfIncidentWatch, WATCH_INTERVAL_MS } = await import('./self-incident-watcher');
const { STAGNATION_THRESHOLD_MS } = await import('./incident-signature-detectors');

let clockMs = Date.parse('2026-09-18T00:00:00.000Z');
function nextPassTime(): number {
  clockMs += WATCH_INTERVAL_MS * 2;
  return clockMs;
}

// Mirrors task #871: a non-terminal task with no live execution/queue item,
// stale well past STAGNATION_THRESHOLD_MS, sitting in a theme's backlog.
function backlogTask(now: number, over: Record<string, unknown> = {}) {
  return {
    id: 871,
    title: '停滞候補タスク',
    status: 'in-progress',
    workflowStatus: 'in_progress',
    updatedAt: new Date(now - STAGNATION_THRESHOLD_MS - 60_000),
    themeId: 25,
    workflowDisabled: false,
    ...over,
  };
}

describe('theme-run-state gate for stagnation/desync (#969)', () => {
  beforeEach(() => {
    taskFindManyMock.mockReset().mockResolvedValue([]);
    taskFindUniqueMock.mockReset().mockResolvedValue(null);
    transitionFindManyMock.mockReset().mockResolvedValue([]);
    transitionFindFirstMock.mockReset().mockResolvedValue(null);
    sessionFindFirstMock.mockReset().mockResolvedValue(null);
    executionFindFirstMock.mockReset().mockResolvedValue(null);
    queueItemFindFirstMock.mockReset().mockResolvedValue(null);
    notificationFindFirstMock.mockReset().mockResolvedValue(null);
    prFindFirstMock.mockReset().mockResolvedValue(null);
    activityLogFindFirstMock.mockReset().mockResolvedValue(null);
    workflowFileFindFirstMock.mockReset().mockResolvedValue(null);
    themeAutoRunFindManyMock.mockReset().mockResolvedValue([]);
    themeFindManyMock.mockReset().mockResolvedValue([]);
    userSettingsFindFirstMock.mockReset().mockResolvedValue(null);
    submitConcernMock.mockReset().mockResolvedValue(1);
    notifyIntakeQuestionPendingMock.mockReset().mockResolvedValue({ id: 1 });
  });

  test('does NOT file stagnation when the theme is running a different task', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([backlogTask(now)]);
    themeAutoRunFindManyMock.mockImplementation((args: unknown) => {
      const where = (args as { where: { status?: string } }).where;
      if (where.status === 'running') {
        return Promise.resolve([{ themeId: 25, currentTaskId: 646 }]);
      }
      return Promise.resolve([]);
    });

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  test('still files stagnation when the theme is running THIS task itself (self-hang)', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([backlogTask(now)]);
    themeAutoRunFindManyMock.mockImplementation((args: unknown) => {
      const where = (args as { where: { status?: string } }).where;
      if (where.status === 'running') {
        return Promise.resolve([{ themeId: 25, currentTaskId: 871 }]);
      }
      return Promise.resolve([]);
    });

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    expect(submitConcernMock).toHaveBeenCalledTimes(1);
  });

  test('still files stagnation when the theme is idle/paused (not running)', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([backlogTask(now, { id: 700 })]);
    themeAutoRunFindManyMock.mockResolvedValue([]); // no running row for themeId 25

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    expect(submitConcernMock).toHaveBeenCalledTimes(1);
  });

  test('queries ThemeAutoRun run-state once per pass, scoped to running rows only', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([backlogTask(now, { id: 871, themeId: 25 })]);
    themeAutoRunFindManyMock.mockResolvedValue([]);

    await runSelfIncidentWatch(now);

    const runStateCalls = themeAutoRunFindManyMock.mock.calls.filter((call) => {
      // Run-state query has no `enabled` filter; the blocked-pipeline armed query (#977) also filters status='running' but adds enabled:true.
      const where = (call[0] as { where: { status?: string; enabled?: boolean } }).where;
      return where.status === 'running' && where.enabled === undefined;
    });
    expect(runStateCalls).toHaveLength(1);
    const query = runStateCalls[0]?.[0] as { where: { themeId: { in: number[] } } };
    expect(new Set(query.where.themeId.in)).toEqual(new Set([25]));
  });
});
