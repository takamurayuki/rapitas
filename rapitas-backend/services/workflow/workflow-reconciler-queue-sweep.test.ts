/**
 * workflow-reconciler-queue-sweep.test
 *
 * Covers the dequeue-independent stale-queue sweep (task 547, concern #4924):
 * queued items for terminal tasks (done / cancelled / wf=completed) are
 * cancelled via a CAS update; non-terminal tasks, null lookups (fail-safe) and
 * items a concurrent dequeue already promoted (CAS count:0) are left alone.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const findManyMock = mock(() => Promise.resolve([] as { id: number; taskId: number }[]));
const updateManyMock = mock(() => Promise.resolve({ count: 1 }));
const mockPrisma = {
  workflowQueueItem: { findMany: findManyMock, updateMany: updateManyMock },
};

const resolveTaskWorkflowStateMock = mock(() =>
  Promise.resolve<{ status?: string | null; workflowStatus?: string | null } | null>(null),
);
const taskRowConfirmedAbsentMock = mock(() => Promise.resolve(false));

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../task/task-resolver', () => ({
  resolveTaskWorkflowState: resolveTaskWorkflowStateMock,
  taskRowConfirmedAbsent: taskRowConfirmedAbsentMock,
}));

const { sweepStaleQueueItems } = await import('./workflow-reconciler-queue-sweep');

describe('sweepStaleQueueItems', () => {
  beforeEach(() => {
    findManyMock.mockReset().mockResolvedValue([]);
    updateManyMock.mockReset().mockResolvedValue({ count: 1 });
    resolveTaskWorkflowStateMock.mockReset().mockResolvedValue(null);
    taskRowConfirmedAbsentMock.mockReset().mockResolvedValue(false);
  });

  test('cancels the queued item of a task with status done (CAS on queued)', async () => {
    findManyMock.mockResolvedValue([{ id: 11, taskId: 537 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({
      status: 'done',
      workflowStatus: 'in_progress',
    });

    const cancelled = await sweepStaleQueueItems();

    expect(cancelled).toBe(1);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
    const call = updateManyMock.mock.calls[0]?.[0] as {
      where: { id: number; status: string };
      data: { status: string; errorMessage: string; completedAt: Date };
    };
    expect(call.where).toEqual({ id: 11, status: 'queued' });
    expect(call.data.status).toBe('cancelled');
    expect(call.data.errorMessage).toContain('定期スイープ');
    expect(call.data.completedAt).toBeInstanceOf(Date);
  });

  test('cancels when workflowStatus is completed even if task.status is non-terminal', async () => {
    findManyMock.mockResolvedValue([{ id: 12, taskId: 540 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({
      status: 'in-progress',
      workflowStatus: 'completed',
    });

    const cancelled = await sweepStaleQueueItems();

    expect(cancelled).toBe(1);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
  });

  test('leaves items of non-terminal tasks untouched', async () => {
    findManyMock.mockResolvedValue([{ id: 13, taskId: 600 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({
      status: 'in-progress',
      workflowStatus: 'research_done',
    });

    const cancelled = await sweepStaleQueueItems();

    expect(cancelled).toBe(0);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  test('a null task lookup is fail-safe — the item is not cancelled', async () => {
    findManyMock.mockResolvedValue([{ id: 14, taskId: 601 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue(null);

    const cancelled = await sweepStaleQueueItems();

    expect(cancelled).toBe(0);
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  test('a confirmed-absent task row cancels the item with the vanished-task marker (task 651)', async () => {
    findManyMock.mockResolvedValue([{ id: 16, taskId: 648 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue(null);
    taskRowConfirmedAbsentMock.mockResolvedValue(true);

    const cancelled = await sweepStaleQueueItems();

    expect(cancelled).toBe(1);
    const call = updateManyMock.mock.calls[0]?.[0] as {
      data: { status: string; errorMessage: string };
    };
    expect(call.data.status).toBe('cancelled');
    expect(call.data.errorMessage).toContain('648');
    expect(call.data.errorMessage).not.toContain('定期スイープ');
  });

  test('a CAS miss (dequeue promoted the item first) is not counted', async () => {
    findManyMock.mockResolvedValue([{ id: 15, taskId: 545 }]);
    resolveTaskWorkflowStateMock.mockResolvedValue({
      status: 'done',
      workflowStatus: 'completed',
    });
    updateManyMock.mockResolvedValue({ count: 0 });

    const cancelled = await sweepStaleQueueItems();

    expect(cancelled).toBe(0);
    expect(updateManyMock).toHaveBeenCalledTimes(1);
  });

  test('an empty queue short-circuits without task lookups', async () => {
    findManyMock.mockResolvedValue([]);

    const cancelled = await sweepStaleQueueItems();

    expect(cancelled).toBe(0);
    expect(resolveTaskWorkflowStateMock).not.toHaveBeenCalled();
  });
});
