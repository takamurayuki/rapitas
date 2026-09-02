/**
 * self-incident-watcher.theme-auto-run-gate.test
 *
 * Watcher-level integration coverage for the Pattern B theme-auto-run gate
 * (task #715), added as a new file rather than growing
 * self-incident-watcher.test.ts past the component size limit. Verifies the
 * watcher resolves each candidate's theme via `ThemeAutoRun.enabled` and
 * passes it through to detectTriStateDesync, using the same mocked-prisma
 * harness as self-incident-watcher.test.ts.
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

let clockMs = Date.parse('2026-08-30T00:00:00.000Z');
function nextPassTime(): number {
  clockMs += WATCH_INTERVAL_MS * 2;
  return clockMs;
}

// Mirrors task #602/#646/#647: retried against a paused theme (themeId=25),
// status reset to 'todo' while workflowStatus stayed mid-phase. updatedAt is
// kept fresh so detectStagnation never fires here — these tests isolate
// Pattern B (todo × advanced workflowStatus) in the watcher's own findings.
function pausedThemeTask(now: number, over: Record<string, unknown> = {}) {
  return {
    id: 602,
    title: '状態不整合タスク',
    status: 'todo',
    workflowStatus: 'in_progress',
    updatedAt: new Date(now - 60_000),
    themeId: 25,
    ...over,
  };
}

describe('theme auto-run gate for pattern B (#715)', () => {
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
    userSettingsFindFirstMock.mockReset().mockResolvedValue(null);
    submitConcernMock.mockReset().mockResolvedValue(1);
    notifyIntakeQuestionPendingMock.mockReset().mockResolvedValue({ id: 1 });
  });

  test('does NOT file a desync concern for a task whose theme has auto-run disabled', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([pausedThemeTask(now)]);
    themeAutoRunFindManyMock.mockResolvedValue([{ themeId: 25 }]);

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  test('still files a desync concern for a task whose theme has auto-run enabled', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([pausedThemeTask(now, { id: 646 })]);
    themeAutoRunFindManyMock.mockResolvedValue([]); // no disabled row for themeId 25

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:tristate-desync:todo-workflow-advanced');
  });

  test('still files a desync concern for an unthemed task (fail open)', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([pausedThemeTask(now, { id: 647, themeId: null })]);

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    expect(themeAutoRunFindManyMock).not.toHaveBeenCalled();
  });

  test('queries ThemeAutoRun once per pass, scoped to the candidates’ distinct theme ids', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([
      pausedThemeTask(now, { id: 602, themeId: 25 }),
      pausedThemeTask(now, { id: 646, themeId: 25 }),
      pausedThemeTask(now, { id: 700, themeId: 9 }),
    ]);
    themeAutoRunFindManyMock.mockResolvedValue([{ themeId: 25 }]);

    await runSelfIncidentWatch(now);

    expect(themeAutoRunFindManyMock).toHaveBeenCalledTimes(1);
    const query = themeAutoRunFindManyMock.mock.calls[0]?.[0] as {
      where: { themeId: { in: number[] }; enabled: boolean };
    };
    expect(new Set(query.where.themeId.in)).toEqual(new Set([25, 9]));
    expect(query.where.enabled).toBe(false);
  });

  test('a disabled theme does not suppress the stagnation signature for the same task', async () => {
    // Pattern B suppression must not blanket-silence other detectors —
    // stagnation still applies to an in-flight, un-dispatched task.
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([
      pausedThemeTask(now, { status: 'in-progress', updatedAt: new Date(now - 40 * 60 * 1000) }),
    ]);
    themeAutoRunFindManyMock.mockResolvedValue([{ themeId: 25 }]);

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:stagnation');
  });
});
