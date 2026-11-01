/**
 * task-label-replace.test
 *
 * `PUT /tasks/:id/labels` replaced a task's labels as two separate writes:
 * `deleteMany` every existing row, then `createMany` the new ones. Not in a
 * transaction — so when the second write failed (a labelId that does not
 * exist is a foreign-key violation, and a connection blip does it too) the old
 * labels were already gone and the new ones never landed. The task came out
 * with NO labels. That is data loss, not a partial save (#1330).
 *
 * Own file — mock.module is process-global.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** What the stand-in database was asked to do, in order. */
let order: string[] = [];
/** Rows the task currently has, as the stand-in database sees them. */
let rows: number[] = [];
/** Set to make the create step fail, the way an invalid labelId does. */
let createThrows: unknown = null;
/** Label ids the stand-in database knows about. */
let knownLabelIds: number[] = [1, 2, 3];

const prisma = {
  taskLabel: {
    deleteMany: mock(async () => {
      order.push('deleteMany');
      rows = [];
      return { count: 0 };
    }),
    createMany: mock(async ({ data }: { data: Array<{ labelId: number }> }) => {
      order.push('createMany');
      if (createThrows) throw createThrows;
      rows = data.map((d) => d.labelId);
      return { count: data.length };
    }),
  },
  label: {
    findMany: mock(async ({ where }: { where: { id: { in: number[] } } }) => {
      order.push('verifyLabels');
      return where.id.in.filter((id) => knownLabelIds.includes(id)).map((id) => ({ id }));
    }),
  },
  task: {
    findUnique: mock(async () => ({ id: 1, taskLabels: rows.map((labelId) => ({ labelId })) })),
  },
  // The replacement runs inside one transaction; the callback gets a client
  // with the same shape, which here is this object itself.
  $transaction: mock(async (fn: (tx: unknown) => Promise<unknown>) => {
    order.push('transaction:begin');
    try {
      const out = await fn(prisma);
      order.push('transaction:commit');
      return out;
    } catch (err) {
      order.push('transaction:rollback');
      // A real rollback restores what deleteMany removed.
      rows = rowsBeforeTransaction;
      throw err;
    }
  }),
};
let rowsBeforeTransaction: number[] = [];

mock.module('../../config/database', () => ({ prisma, ensureDatabaseConnection: async () => {} }));
mock.module('../../config', () => ({ prisma, ensureDatabaseConnection: async () => {} }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { replaceTaskLabels } = await import('./task-label-replace');

beforeEach(() => {
  order = [];
  rows = [1, 2];
  rowsBeforeTransaction = [1, 2];
  createThrows = null;
  knownLabelIds = [1, 2, 3];
});

describe('replaceTaskLabels', () => {
  test('replaces the labels in one transaction', async () => {
    await replaceTaskLabels(prisma as never, 1, [3]);

    expect(order).toContain('transaction:begin');
    expect(order.indexOf('deleteMany')).toBeGreaterThan(order.indexOf('transaction:begin'));
    expect(order.indexOf('createMany')).toBeGreaterThan(order.indexOf('deleteMany'));
    expect(order).toContain('transaction:commit');
    expect(rows).toEqual([3]);
  });

  // The whole point: a failed create must not leave the task stripped.
  test('leaves the existing labels in place when the create fails', async () => {
    createThrows = Object.assign(new Error('Foreign key constraint failed'), { code: 'P2003' });

    await expect(replaceTaskLabels(prisma as never, 1, [3])).rejects.toThrow();

    expect(order).toContain('transaction:rollback');
    expect(rows).toEqual([1, 2]);
  });

  // An id that does not exist is the realistic cause of that failure, so it is
  // refused up front rather than left to the foreign key — which lets the
  // caller be told WHICH id was wrong.
  test('refuses an unknown labelId before touching anything', async () => {
    await expect(replaceTaskLabels(prisma as never, 1, [999])).rejects.toThrow(/999/);

    expect(order).not.toContain('deleteMany');
    expect(rows).toEqual([1, 2]);
  });

  test('names every unknown id, not just the first', async () => {
    await expect(replaceTaskLabels(prisma as never, 1, [998, 999])).rejects.toThrow(/998.*999/);
  });

  test('clearing all labels is allowed and needs no verification', async () => {
    await replaceTaskLabels(prisma as never, 1, []);

    expect(order).toContain('deleteMany');
    expect(order).not.toContain('createMany');
    expect(order).not.toContain('verifyLabels');
    expect(rows).toEqual([]);
  });

  test('deduplicates ids so one label cannot be attached twice', async () => {
    await replaceTaskLabels(prisma as never, 1, [3, 3]);
    expect(rows).toEqual([3]);
  });
});
