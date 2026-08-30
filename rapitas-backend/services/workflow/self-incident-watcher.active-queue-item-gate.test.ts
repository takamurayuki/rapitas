/**
 * self-incident-watcher.active-queue-item-gate.test
 *
 * Watcher-level integration coverage for the Pattern B active-queue-item gate
 * (task #769), added as a new file rather than growing
 * self-incident-watcher.test.ts past the component size limit. Verifies the
 * watcher passes `hasActiveQueueItem` through to detectTriStateDesync so a
 * task still sitting in the dispatch queue is not misreported as a
 * status/workflowStatus desync, mirroring the theme-auto-run-gate harness.
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

let clockMs = Date.parse('2026-08-30T02:00:00.000Z');
function nextPassTime(): number {
  clockMs += WATCH_INTERVAL_MS * 2;
  return clockMs;
}

// Mirrors task #755: auto_approve_plan (not in RECOVERY_REQUEUE_CAUSES)
// advanced workflowStatus to plan_approved while task.status stayed 'todo'
// because the task was still queued for dispatch. updatedAt is kept fresh so
// detectStagnation never fires here — these tests isolate Pattern B
// (todo × advanced workflowStatus) in the watcher's own findings.
function queuedTask(now: number, over: Record<string, unknown> = {}) {
  return {
    id: 755,
    title: '状態不整合タスク',
    status: 'todo',
    workflowStatus: 'plan_approved',
    updatedAt: new Date(now - 60_000),
    themeId: null,
    ...over,
  };
}

describe('active queue item gate for pattern B (#769)', () => {
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
    submitConcernMock.mockReset().mockResolvedValue(1);
    notifyIntakeQuestionPendingMock.mockReset().mockResolvedValue({ id: 1 });
  });

  test('does NOT file a desync concern for a queued task, even on a non-recovery cause', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([queuedTask(now)]);
    transitionFindManyMock.mockResolvedValue([
      {
        createdAt: new Date(now - 60_000),
        fromStatus: 'plan_created',
        toStatus: 'plan_approved',
        actor: 'system',
        cause: 'auto_approve_plan',
        phase: 'plan',
        invariantViolation: false,
      },
    ]);
    queueItemFindFirstMock.mockResolvedValue({ id: 1 });

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(0);
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  test('still files a desync concern for the same shape once the queue item is gone', async () => {
    const now = nextPassTime();
    taskFindManyMock.mockResolvedValue([queuedTask(now, { id: 756 })]);
    transitionFindManyMock.mockResolvedValue([
      {
        createdAt: new Date(now - 60_000),
        fromStatus: 'plan_created',
        toStatus: 'plan_approved',
        actor: 'system',
        cause: 'auto_approve_plan',
        phase: 'plan',
        invariantViolation: false,
      },
    ]);
    queueItemFindFirstMock.mockResolvedValue(null);

    const filed = await runSelfIncidentWatch(now);

    expect(filed).toBe(1);
    const input = submitConcernMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.dedupKey).toBe('self-incident:tristate-desync:todo-workflow-advanced');
  });
});
