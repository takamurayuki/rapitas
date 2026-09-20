/**
 * self-incident-watcher.blocked-escalation.test
 *
 * Watcher-level integration coverage for #980: a blocked task whose escalation
 * notice is inside the re-notify window is not filed as stagnation; outside the
 * window (or with no notice) detection resumes. Same mocked-prisma harness as
 * self-incident-watcher.theme-auto-run-gate.test.ts.
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
// #860: theme.findMany feeds resolveNonDevelopmentThemeIds — default [] means
// no candidate theme is treated as non-development (fail-open).
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

let clockMs = Date.parse('2026-08-30T00:00:00.000Z');
function nextPassTime(): number {
  clockMs += WATCH_INTERVAL_MS * 2;
  return clockMs;
}

const HOUR = 60 * 60 * 1000;

// blocked, idle 100min (> 30min threshold), nothing running or queued.
function blockedTask(now: number) {
  return {
    id: 970,
    title: '停滞blockedタスク',
    status: 'blocked',
    workflowStatus: 'in_progress',
    updatedAt: new Date(now - 100 * 60_000),
    themeId: null,
  };
}

// Only the dedicated escalation query (cause filter) returns the notice.
function mockEscalationAt(createdAt: Date | null) {
  transitionFindManyMock.mockImplementation((args: unknown) => {
    const where = (args as { where?: { cause?: unknown } }).where;
    return Promise.resolve(where?.cause && createdAt ? [{ createdAt }] : []);
  });
}

describe('blocked escalation window for stagnation (#980)', () => {
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

  test('does NOT file stagnation when the escalation notice was 3h ago', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([blockedTask(now)]);
    mockEscalationAt(new Date(now - 3 * HOUR));

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  test('files stagnation again when the last notice is 5h old (notifier presumed dead)', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([blockedTask(now)]);
    mockEscalationAt(new Date(now - 5 * HOUR));

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:stagnation');
  });

  test('files stagnation when a blocked task was never notified', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([blockedTask(now)]);
    mockEscalationAt(null);

    expect(await runSelfIncidentWatch(now)).toBe(1);
  });

  test('a non-blocked task is not exempted by a recent notice', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([{ ...blockedTask(now), status: 'in-progress' }]);
    mockEscalationAt(new Date(now - 3 * HOUR));

    expect(await runSelfIncidentWatch(now)).toBe(1);
  });
});
