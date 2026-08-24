/**
 * task_queue.test
 *
 * Covers reapStuckProcessing(): rows past the stale threshold requeue to
 * pending (under maxAttempts) or dead_letter (at/over maxAttempts), rows
 * within the threshold are left untouched, and a zero-row queue is a no-op.
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

interface TaskRow {
  id: number;
  taskType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  startedAt: Date | null;
}

let tasks: TaskRow[] = [];
const updateCalls: Array<{ id: number; data: Record<string, unknown> }> = [];

mock.module('../../config/database', () => ({
  prisma: {
    memoryTaskQueue: {
      findMany: mock((args: { where: { status: string; OR: unknown[] } }) => {
        const cutoff = (
          args.where.OR.find(
            (c): c is { startedAt: { lt: Date } } =>
              typeof c === 'object' && c !== null && 'startedAt' in c && c.startedAt !== null,
          ) as { startedAt: { lt: Date } } | undefined
        )?.startedAt.lt;
        const matched = tasks.filter(
          (t) =>
            t.status === args.where.status &&
            (t.startedAt === null || (cutoff !== undefined && t.startedAt < cutoff)),
        );
        return Promise.resolve(matched);
      }),
      update: mock((args: { where: { id: number }; data: Record<string, unknown> }) => {
        updateCalls.push({ id: args.where.id, data: args.data });
        const t = tasks.find((x) => x.id === args.where.id);
        if (t) Object.assign(t, args.data);
        return Promise.resolve(t ?? {});
      }),
    },
  },
}));

const { MemoryTaskQueueProcessor } = await import('./task_queue');

function stuckTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 1,
    taskType: 'distill',
    status: 'processing',
    attempts: 1,
    maxAttempts: 3,
    startedAt: new Date(Date.now() - 10 * 60 * 1000),
    ...overrides,
  };
}

beforeEach(() => {
  tasks = [];
  updateCalls.length = 0;
});

describe('reapStuckProcessing', () => {
  test('requeues a stuck row under maxAttempts to pending', async () => {
    tasks.push(stuckTask({ id: 1, attempts: 1, maxAttempts: 3 }));
    const processor = new MemoryTaskQueueProcessor();

    const result = await processor.reapStuckProcessing(5 * 60 * 1000);

    expect(result).toEqual({ reapedToPending: 1, reapedToDeadLetter: 0 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.data.status).toBe('pending');
    expect(tasks[0]?.status).toBe('pending');
  });

  test('moves a stuck row at maxAttempts to dead_letter instead of retrying forever', async () => {
    tasks.push(stuckTask({ id: 2, attempts: 3, maxAttempts: 3 }));
    const processor = new MemoryTaskQueueProcessor();

    const result = await processor.reapStuckProcessing(5 * 60 * 1000);

    expect(result).toEqual({ reapedToPending: 0, reapedToDeadLetter: 1 });
    expect(updateCalls[0]?.data.status).toBe('dead_letter');
    expect(tasks[0]?.status).toBe('dead_letter');
  });

  test('does not reap a row still within the stale threshold (in-flight task)', async () => {
    tasks.push(stuckTask({ id: 3, startedAt: new Date(Date.now() - 30 * 1000) }));
    const processor = new MemoryTaskQueueProcessor();

    const result = await processor.reapStuckProcessing(5 * 60 * 1000);

    expect(result).toEqual({ reapedToPending: 0, reapedToDeadLetter: 0 });
    expect(updateCalls).toHaveLength(0);
    expect(tasks[0]?.status).toBe('processing');
  });

  test('is a no-op when the queue has no processing rows', async () => {
    const processor = new MemoryTaskQueueProcessor();

    const result = await processor.reapStuckProcessing(5 * 60 * 1000);

    expect(result).toEqual({ reapedToPending: 0, reapedToDeadLetter: 0 });
    expect(updateCalls).toHaveLength(0);
  });

  test('reaps multiple stuck rows independently by attempts count', async () => {
    tasks.push(
      stuckTask({ id: 4, attempts: 0, maxAttempts: 3 }),
      stuckTask({ id: 5, attempts: 3, maxAttempts: 3 }),
      stuckTask({ id: 6, attempts: 2, maxAttempts: 3 }),
    );
    const processor = new MemoryTaskQueueProcessor();

    const result = await processor.reapStuckProcessing(5 * 60 * 1000);

    expect(result).toEqual({ reapedToPending: 2, reapedToDeadLetter: 1 });
  });
});
