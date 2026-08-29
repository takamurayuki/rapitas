/**
 * self-incident-watcher.pattern-a-grace.test
 *
 * Watcher-level integration coverage for the Pattern A
 * (`session_failed_execution_active`) settle window (task 718), added as a
 * new file rather than growing self-incident-watcher.test.ts past the
 * component size limit. Verifies the concern is suppressed within the grace
 * window and filed once it settles, using the same mocked-prisma harness as
 * self-incident-watcher.test.ts.
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
const { PATTERN_A_SETTLE_MS } = await import('./incident-signature-detectors');

let clockMs = Date.parse('2026-08-28T00:00:00.000Z');
function nextPassTime(): number {
  clockMs += WATCH_INTERVAL_MS * 2;
  return clockMs;
}

function failedSessionActiveExecTask(now: number, over: Record<string, unknown> = {}) {
  return {
    id: 715,
    title: '状態不整合タスク',
    status: 'in-progress',
    workflowStatus: 'research_done',
    updatedAt: new Date(now - 60_000), // fresh → stagnation must NOT fire
    ...over,
  };
}

describe('pattern A settle window at the watcher level (#718)', () => {
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
    submitConcernMock.mockReset().mockResolvedValue(1);
    notifyIntakeQuestionPendingMock.mockReset().mockResolvedValue({ id: 1 });
  });

  test('does NOT file a desync concern 60s after the session failed (within grace)', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([failedSessionActiveExecTask(now)]);
    sessionFindFirstMock.mockResolvedValue({
      id: 3156,
      status: 'failed',
      updatedAt: new Date(now - 60_000),
      agentExecutions: [{ id: 3139, status: 'running' }],
    });

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  test('files a desync concern once the session update settled past the threshold', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([failedSessionActiveExecTask(now)]);
    sessionFindFirstMock.mockResolvedValue({
      id: 3156,
      status: 'failed',
      updatedAt: new Date(now - PATTERN_A_SETTLE_MS),
      agentExecutions: [{ id: 3139, status: 'running' }],
    });

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:tristate-desync:session-failed-exec-active');
    expect(input.severity).toBe('high');
  });
});
