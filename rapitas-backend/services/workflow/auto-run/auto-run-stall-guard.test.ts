/**
 * auto-run-stall-guard.test
 *
 * Covers releaseStaleActiveItems (task 618, 事例2): active queue items of an
 * already-terminal current task are CAS-cancelled in bulk (with cycle log +
 * notification), while non-terminal tasks, null lookups (fail-safe) and lost
 * CAS races are strict no-ops.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../../generated/prisma-postgres';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const updateManyMock = mock(() => Promise.resolve({ count: 0 }));
const fakePrisma = {
  workflowQueueItem: { updateMany: updateManyMock },
} as unknown as PrismaClient;

const resolveTaskWorkflowStateMock = mock(() =>
  Promise.resolve<{ status?: string | null; workflowStatus?: string | null } | null>(null),
);
const logCycleEventMock = mock(() => {});
const notifyStallReleasedMock = mock(() => Promise.resolve());

mock.module('../../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../task/task-resolver', () => ({
  resolveTaskWorkflowState: resolveTaskWorkflowStateMock,
}));
// Mirror of the real pure predicate (positive terminal evidence only) so the
// guard's branching is exercised without loading the whole workflow-queue module.
mock.module('../workflow-queue', () => ({
  isTaskTerminalForQueue: (
    task: { status?: string | null; workflowStatus?: string | null } | null,
  ) =>
    !!task &&
    (task.status === 'done' || task.status === 'cancelled' || task.workflowStatus === 'completed'),
}));
mock.module('../../observability', () => ({
  logCycleEvent: logCycleEventMock,
  getCycleLogFilePath: () => '/tmp/cycle.ndjson',
}));
const stopTaskAgentsMock = mock(() => Promise.resolve({ stopped: 1 }));
mock.module('../../agents/stop-task-agents', () => ({
  stopTaskAgents: stopTaskAgentsMock,
}));
mock.module('./auto-run-notifications', () => ({
  notifyStallReleased: notifyStallReleasedMock,
}));

const { releaseStaleActiveItems } = await import('./auto-run-stall-guard');

const ITEMS = [
  { id: 11, taskId: 617, status: 'running' },
  { id: 12, taskId: 617, status: 'queued' },
];

describe('releaseStaleActiveItems', () => {
  beforeEach(() => {
    updateManyMock.mockReset().mockResolvedValue({ count: 0 });
    resolveTaskWorkflowStateMock.mockReset().mockResolvedValue(null);
    logCycleEventMock.mockReset();
    notifyStallReleasedMock.mockReset().mockResolvedValue(undefined);
  });

  test('a non-terminal task is a strict no-op (0, no update, no notify)', async () => {
    resolveTaskWorkflowStateMock.mockResolvedValue({
      status: 'in-progress',
      workflowStatus: 'in_progress',
    });

    const released = await releaseStaleActiveItems(fakePrisma, 1, 617, ITEMS);

    expect(released).toBe(0);
    expect(updateManyMock).not.toHaveBeenCalled();
    expect(notifyStallReleasedMock).not.toHaveBeenCalled();
  });

  test('a null task lookup is fail-safe — nothing is cancelled', async () => {
    resolveTaskWorkflowStateMock.mockResolvedValue(null);

    const released = await releaseStaleActiveItems(fakePrisma, 1, 617, ITEMS);

    expect(released).toBe(0);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  test('a terminal (done) task with residue: bulk CAS-cancel + cycle log + notification', async () => {
    resolveTaskWorkflowStateMock.mockResolvedValue({ status: 'done', workflowStatus: null });
    updateManyMock.mockResolvedValue({ count: 2 });

    const released = await releaseStaleActiveItems(fakePrisma, 1, 617, ITEMS);

    expect(released).toBe(2);
    // Released residue must not leave an agent running on a done task (#856).
    expect(stopTaskAgentsMock).toHaveBeenCalledTimes(1);
    expect((stopTaskAgentsMock.mock.calls[0] as unknown[])[0]).toBe(617);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const call = updateManyMock.mock.calls[0]?.[0] as {
      where: { id: { in: number[] }; status: { in: string[] } };
      data: { status: string; completedAt: Date; errorMessage: string };
    };
    expect(call.where.id.in).toEqual([11, 12]);
    expect(call.where.status.in).toEqual(['queued', 'running', 'waiting_approval']);
    expect(call.data.status).toBe('cancelled');
    expect(call.data.completedAt).toBeInstanceOf(Date);
    expect(logCycleEventMock).toHaveBeenCalledWith(
      'task.stall_released',
      expect.objectContaining({
        theme: 1,
        task: 617,
        ok: true,
        cause: 'terminal_task_active_item_residue',
        count: 2,
      }),
    );
    expect(notifyStallReleasedMock).toHaveBeenCalledWith(
      1,
      617,
      2,
      'terminal_task_active_item_residue',
    );
  });

  test('workflowStatus=completed counts as terminal even when task.status is non-terminal', async () => {
    resolveTaskWorkflowStateMock.mockResolvedValue({
      status: 'in-progress',
      workflowStatus: 'completed',
    });
    updateManyMock.mockResolvedValue({ count: 1 });

    const released = await releaseStaleActiveItems(fakePrisma, 1, 617, [ITEMS[0]!]);

    expect(released).toBe(1);
  });

  test('a lost CAS race (count:0 — stop/dequeue already updated the items) returns 0 without notifying', async () => {
    resolveTaskWorkflowStateMock.mockResolvedValue({ status: 'done', workflowStatus: null });
    updateManyMock.mockResolvedValue({ count: 0 });

    const released = await releaseStaleActiveItems(fakePrisma, 1, 617, ITEMS);

    expect(released).toBe(0);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    expect(logCycleEventMock).not.toHaveBeenCalled();
    expect(notifyStallReleasedMock).not.toHaveBeenCalled();
  });

  test('an empty item list returns 0 without touching the DB', async () => {
    resolveTaskWorkflowStateMock.mockResolvedValue({ status: 'done', workflowStatus: null });

    const released = await releaseStaleActiveItems(fakePrisma, 1, 617, []);

    expect(released).toBe(0);
    expect(updateManyMock).not.toHaveBeenCalled();
  });
});
