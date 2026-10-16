/**
 * task_queue.test
 *
 * Covers reapStuckProcessing(): rows past the stale threshold requeue to
 * pending (under maxAttempts) or dead_letter (at/over maxAttempts), rows
 * within the threshold are left untouched, and a zero-row queue is a no-op.
 * Also covers computeRetryDelayMs(), processNext()'s retry/dead_letter
 * branches, and getDeadLetterTasks(). Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

interface TaskRow {
  id: number;
  taskType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  startedAt: Date | null;
  priority?: number;
  payload?: string;
  createdAt?: Date;
  updatedAt?: Date;
  errorMessage?: string | null;
}

let tasks: TaskRow[] = [];
let deadLetterRows: TaskRow[] = [];
const updateCalls: Array<{ id: number; data: Record<string, unknown> }> = [];
let findFirstResult: TaskRow | null = null;
let findManyDeadLetterArgs: {
  where: Record<string, unknown>;
  orderBy: unknown;
  take: number;
} | null = null;

mock.module('../../config/database', () => ({
  prisma: {
    memoryTaskQueue: {
      findFirst: mock(() => Promise.resolve(findFirstResult)),
      findMany: mock(
        (args: { where: { status: string; OR?: unknown[] }; orderBy?: unknown; take?: number }) => {
          // Dead-letter diagnosis path: status === 'dead_letter' with no OR clause.
          if (args.where.status === 'dead_letter' && !args.where.OR) {
            findManyDeadLetterArgs = {
              where: args.where,
              orderBy: args.orderBy,
              take: args.take ?? 0,
            };
            return Promise.resolve(deadLetterRows);
          }
          const OR = args.where.OR ?? [];
          const cutoff = (
            OR.find(
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
        },
      ),
      update: mock((args: { where: { id: number }; data: Record<string, unknown> }) => {
        updateCalls.push({ id: args.where.id, data: args.data });
        const t = tasks.find((x) => x.id === args.where.id);
        if (t) Object.assign(t, args.data);
        return Promise.resolve(t ?? {});
      }),
    },
  },
}));

const { MemoryTaskQueueProcessor, computeRetryDelayMs } = await import('./task_queue');

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
  deadLetterRows = [];
  updateCalls.length = 0;
  findFirstResult = null;
  findManyDeadLetterArgs = null;
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

describe('computeRetryDelayMs', () => {
  const ENV_KEYS = ['RAPITAS_MEMORY_QUEUE_RETRY_BASE_MS', 'RAPITAS_MEMORY_QUEUE_RETRY_MAX_MS'];
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  test('first failure returns the default base delay (30s)', () => {
    expect(computeRetryDelayMs(1)).toBe(30_000);
  });

  test('second failure doubles the base delay (60s)', () => {
    expect(computeRetryDelayMs(2)).toBe(60_000);
  });

  test('clamps to the default max delay (5min) for large attempt counts', () => {
    expect(computeRetryDelayMs(10)).toBe(300_000);
  });

  test('honors overridden base/max env vars', () => {
    process.env.RAPITAS_MEMORY_QUEUE_RETRY_BASE_MS = '1000';
    process.env.RAPITAS_MEMORY_QUEUE_RETRY_MAX_MS = '4000';
    expect(computeRetryDelayMs(1)).toBe(1000);
    expect(computeRetryDelayMs(2)).toBe(2000);
    expect(computeRetryDelayMs(5)).toBe(4000);
  });
});

describe('processNext retry backoff', () => {
  function pendingTask(overrides: Partial<TaskRow> = {}): TaskRow {
    return {
      id: 10,
      taskType: 'embed',
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      startedAt: null,
      priority: 0,
      payload: '{}',
      createdAt: new Date(),
      ...overrides,
    };
  }

  test('a transient failure under maxAttempts retries with a backoff-delayed scheduledAt', async () => {
    findFirstResult = pendingTask({ attempts: 0, maxAttempts: 3 });
    const processor = new MemoryTaskQueueProcessor();
    processor.registerHandler('embed', async () => {
      throw new Error('transient failure');
    });

    const before = Date.now();
    const p = processor as unknown as { processNext(): Promise<void> };
    await p.processNext();
    const after = Date.now();

    const retryUpdate = updateCalls.find((c) => c.data.status === 'pending');
    expect(retryUpdate).toBeDefined();
    const scheduledAt = retryUpdate?.data.scheduledAt as Date;
    expect(scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 28_000);
    expect(scheduledAt.getTime()).toBeLessThanOrEqual(after + 32_000);
  });

  test('a failure at maxAttempts moves to dead_letter without a scheduledAt update', async () => {
    findFirstResult = pendingTask({ attempts: 2, maxAttempts: 3 });
    const processor = new MemoryTaskQueueProcessor();
    processor.registerHandler('embed', async () => {
      throw new Error('persistent failure');
    });

    const p = processor as unknown as { processNext(): Promise<void> };
    await p.processNext();

    const deadLetterUpdate = updateCalls.find((c) => c.data.status === 'dead_letter');
    expect(deadLetterUpdate).toBeDefined();
    expect(deadLetterUpdate?.data.scheduledAt).toBeUndefined();
  });

  test('a successful handler run completes without touching scheduledAt', async () => {
    findFirstResult = pendingTask({ attempts: 0, maxAttempts: 3 });
    const processor = new MemoryTaskQueueProcessor();
    processor.registerHandler('embed', async () => {});

    const p = processor as unknown as { processNext(): Promise<void> };
    await p.processNext();

    const completedUpdate = updateCalls.find((c) => c.data.status === 'completed');
    expect(completedUpdate).toBeDefined();
    expect(completedUpdate?.data.scheduledAt).toBeUndefined();
  });
});

describe('getDeadLetterTasks', () => {
  test('returns dead_letter rows with payload parsed', async () => {
    deadLetterRows = [
      {
        id: 1,
        taskType: 'embed',
        status: 'dead_letter',
        attempts: 3,
        maxAttempts: 3,
        startedAt: null,
        payload: JSON.stringify({ entryId: 42 }),
        errorMessage: 'boom',
        createdAt: new Date('2026-08-28T01:00:00Z'),
        updatedAt: new Date('2026-08-28T01:16:14Z'),
      },
    ];
    const processor = new MemoryTaskQueueProcessor();

    const result = await processor.getDeadLetterTasks(50);

    expect(result).toHaveLength(1);
    expect(result[0]?.payload).toEqual({ entryId: 42 });
    expect(result[0]?.errorMessage).toBe('boom');
  });

  test('falls back to { _raw } when payload JSON is malformed', async () => {
    deadLetterRows = [
      {
        id: 2,
        taskType: 'validate',
        status: 'dead_letter',
        attempts: 3,
        maxAttempts: 3,
        startedAt: null,
        payload: '{not valid json',
        errorMessage: 'parse issue upstream',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];
    const processor = new MemoryTaskQueueProcessor();

    const result = await processor.getDeadLetterTasks(50);

    expect(result[0]?.payload).toEqual({ _raw: '{not valid json' });
  });

  test('queries with status dead_letter, orderBy updatedAt desc, and the given limit', async () => {
    deadLetterRows = [];
    const processor = new MemoryTaskQueueProcessor();

    await processor.getDeadLetterTasks(25);

    expect(findManyDeadLetterArgs?.where).toEqual({ status: 'dead_letter' });
    expect(findManyDeadLetterArgs?.orderBy).toEqual({ updatedAt: 'desc' });
    expect(findManyDeadLetterArgs?.take).toBe(25);
  });
});
