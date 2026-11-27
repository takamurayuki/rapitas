/**
 * auto-run-resolve-outcome.awaiting-ci.test
 *
 * Task 1568: a task whose PR is open and waits for CI / the required merge hands its queue item
 * back (phase `awaiting_ci`). The scheduler must free the theme's slot WITHOUT counting a finished
 * task, pick the next task, and never re-enqueue the waiting one.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../../generated/prisma-postgres';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../observability', () => ({ logCycleEvent: mock(() => {}) }));
mock.module('../blocked-task-write', () => ({ writeBlockedTask: mock(async () => {}) }));

let taskState: { status: string; workflowStatus: string | null } | null = null;
mock.module('../../task/task-resolver', () => ({
  resolveTaskWorkflowState: mock(async () => taskState),
}));

const enqueueMock = mock(async () => ({}));
mock.module('../workflow-queue', () => ({
  WorkflowQueueService: { getInstance: () => ({ enqueue: enqueueMock }) },
  isTaskTerminalForQueue: (t: { status: string; workflowStatus?: string | null } | null) =>
    !!t && (t.status === 'done' || t.workflowStatus === 'completed'),
}));
mock.module('./auto-run-hold-check', () => ({
  readAutoRunHold: mock(async () => ({ held: false })),
}));
mock.module('./auto-run-selection', () => ({
  COOLDOWN_MS: 0,
  isAwaitingUserAnswer: mock(async () => false),
}));
mock.module('./queue-wait-exemption', () => ({ liveOrQueuedBehind: mock(async () => false) }));
mock.module('./requeue-if-never-executed', () => ({
  requeueIfNeverExecuted: mock(async () => false),
}));
const releaseThemeSlotMock = mock(async () => 'head_removed');
const retrackThemeSlotMock = mock(async () => {});
mock.module('./parallel/theme-active-set', () => ({
  releaseThemeSlot: releaseThemeSlotMock,
  retrackThemeSlot: retrackThemeSlotMock,
}));
mock.module('./auto-run-notifications', () => ({
  notifyAwaitingUserAnswer: mock(async () => {}),
  notifyTaskSkipped: mock(async () => {}),
  notifyTaskVanished: mock(async () => {}),
}));
mock.module('./auto-run-terminal-current', () => ({
  isCancelledCurrent: () => false,
  releaseCancelledCurrent: mock(async () => {}),
}));
mock.module('./auto-run-lifecycle', () => ({ broadcastAutoRunUpdateImpl: mock(() => {}) }));
const selectNextMock = mock(async () => {});
mock.module('./auto-run-advance-select', () => ({ selectAndEnqueueNextTask: selectNextMock }));
mock.module('./auto-run-recovery-history', () => ({
  hasRunawayCancelLoop: mock(async () => false),
  userActedAfter: mock(async () => false),
}));

let awaitingCi = false;
let lookupFails = false;
mock.module('../awaiting-ci-lookup', () => ({
  isTaskAwaitingCi: mock(async () => awaitingCi),
  readTaskAwaitingCi: mock(async () => {
    if (lookupFails) throw new Error('database unavailable');
    return awaitingCi;
  }),
  isQueueItemHandedBack: mock(async () => false),
  isItemStillOwned: mock(async () => true),
  listAwaitingCi: mock(async () => []),
}));

const { resolveCurrentTaskOutcome } = await import('./auto-run-resolve-outcome');

let terminalItem: Record<string, unknown> | null = null;
const prisma = {
  workflowQueueItem: { findFirst: mock(async () => terminalItem) },
} as unknown as PrismaClient;

const run = () => resolveCurrentTaskOutcome(prisma, 1, 100, 'priority', 1, new Map());

beforeEach(() => {
  releaseThemeSlotMock.mockClear();
  retrackThemeSlotMock.mockClear();
  selectNextMock.mockClear();
  enqueueMock.mockClear();
  awaitingCi = false;
  lookupFails = false;
  taskState = { status: 'in-progress', workflowStatus: 'verify_done' };
  terminalItem = {
    id: 5,
    status: 'completed',
    currentPhase: 'awaiting_ci',
    errorMessage: null,
    completedAt: new Date(),
  };
});

describe('resolveCurrentTaskOutcome — CI wait (task 1568)', () => {
  test('A waits for CI: its slot is released uncounted and the theme selects the next task', async () => {
    await run();
    expect(releaseThemeSlotMock).toHaveBeenCalledTimes(1);
    expect(releaseThemeSlotMock.mock.calls[0]).toEqual([prisma, 1, 100, 'released']);
    expect(selectNextMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(retrackThemeSlotMock).not.toHaveBeenCalled();
  });

  test('a plain completed item is still counted as a completed task (control)', async () => {
    terminalItem = { ...terminalItem, currentPhase: 'completed' };
    taskState = { status: 'done', workflowStatus: 'completed' };
    await run();
    expect(releaseThemeSlotMock.mock.calls[0]).toEqual([prisma, 1, 100, 'completed']);
  });

  test('CI green: the task is done by the watcher, so the normal completed release applies', async () => {
    taskState = { status: 'done', workflowStatus: 'completed' };
    await run();
    expect(releaseThemeSlotMock.mock.calls[0]).toEqual([prisma, 1, 100, 'completed']);
    expect(selectNextMock).toHaveBeenCalledTimes(1);
  });

  // The window where ci-self-repair already moved the task out of verify_done but has not queued
  // its repair item yet: the stale awaiting_ci item must not count as the task's completion.
  test('CI red window: the stale awaiting_ci item is released uncounted, never completed', async () => {
    taskState = { status: 'in-progress', workflowStatus: 'ci_repair' };
    await run();
    expect(releaseThemeSlotMock.mock.calls.map((c) => c[3])).toEqual(['released']);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(selectNextMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveCurrentTaskOutcome — CI wait without any item on file (task 1568)', () => {
  test('no handed-back item recorded: the waiting task is released, never re-enqueued', async () => {
    terminalItem = null;
    awaitingCi = true;
    await run();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(releaseThemeSlotMock.mock.calls.map((c) => c[3])).toEqual(['released']);
    expect(selectNextMock).toHaveBeenCalledTimes(1);
  });

  test('control: the same vanished item of a task that is not CI-waiting is re-enqueued', async () => {
    terminalItem = null;
    awaitingCi = false;
    await run();
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  test('the CI wait cannot be read: nothing is re-enqueued or released, the next tick retries', async () => {
    terminalItem = null;
    lookupFails = true;
    await run();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(releaseThemeSlotMock).not.toHaveBeenCalled();
    expect(selectNextMock).not.toHaveBeenCalled();
  });
});
