/**
 * awaiting-ci-lookup.test
 *
 * Task 1568: the CI-wait shape needs the held state AND the required-merge cause as the LATEST
 * transition — a task parked at verify_done for another reason (review hold, repair) is not one.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const taskFindUnique = mock(async (_a: unknown): Promise<unknown> => null);
const transitionFindFirst = mock(async (_a: unknown): Promise<unknown> => null);
const itemFindUnique = mock(async (_a: unknown): Promise<unknown> => null);
const itemFindMany = mock(async (_a: unknown): Promise<unknown[]> => []);
const taskFindMany = mock(async (_a: unknown): Promise<unknown[]> => []);
mock.module('../../config', () => ({
  prisma: {
    task: { findUnique: taskFindUnique, findMany: taskFindMany },
    workflowTransition: { findFirst: transitionFindFirst },
    workflowQueueItem: { findUnique: itemFindUnique, findMany: itemFindMany },
  },
}));
mock.module('./required-merge-hold', () => ({
  AWAITING_REQUIRED_MERGE_CAUSE: 'verify_awaiting_required_merge',
  holdForRequiredMerge: mock(async () => true),
}));

const {
  readTaskAwaitingCi,
  isTaskAwaitingCi,
  isQueueItemHandedBack,
  isItemStillOwned,
  listAwaitingCi,
} = await import('./awaiting-ci-lookup');

const held = { status: 'in-progress', workflowStatus: 'verify_done', haltReason: null };

beforeEach(() => {
  taskFindUnique.mockReset().mockResolvedValue(held);
  transitionFindFirst.mockReset().mockResolvedValue({ cause: 'verify_awaiting_required_merge' });
  itemFindUnique.mockReset().mockResolvedValue(null);
  itemFindMany.mockReset().mockResolvedValue([]);
  taskFindMany.mockReset().mockResolvedValue([]);
});

describe('isTaskAwaitingCi', () => {
  test('held shape + required-merge cause → true', async () => {
    expect(await isTaskAwaitingCi(1)).toBe(true);
  });
  test('latest cause is something else (review hold) → false', async () => {
    transitionFindFirst.mockResolvedValue({ cause: 'review_hold' });
    expect(await isTaskAwaitingCi(1)).toBe(false);
  });
  test('halted task → false', async () => {
    taskFindUnique.mockResolvedValue({ ...held, haltReason: 'awaiting_review_decision' });
    expect(await isTaskAwaitingCi(1)).toBe(false);
  });
  test.each([
    ['completed', { status: 'done', workflowStatus: 'completed', haltReason: null }],
    ['ci repair', { status: 'in-progress', workflowStatus: 'ci_repair', haltReason: null }],
    ['missing task', null],
  ])('%s → false', async (_n, task) => {
    taskFindUnique.mockResolvedValue(task);
    expect(await isTaskAwaitingCi(1)).toBe(false);
  });
  test('a read error is never a CI wait', async () => {
    taskFindUnique.mockRejectedValue(new Error('db'));
    expect(await isTaskAwaitingCi(1)).toBe(false);
  });
});

describe('readTaskAwaitingCi — "cannot tell" is never "not waiting"', () => {
  test('the task read fails: throws', async () => {
    taskFindUnique.mockRejectedValue(new Error('task read'));
    await expect(readTaskAwaitingCi(1)).rejects.toThrow('task read');
  });
  test('only the latest-transition read fails: throws, not false', async () => {
    transitionFindFirst.mockRejectedValue(new Error('transition read'));
    await expect(readTaskAwaitingCi(1)).rejects.toThrow('transition read');
    expect(await isTaskAwaitingCi(1)).toBe(false); // positive-evidence callers keep things as is
  });
  test('a read that succeeds answers both ways', async () => {
    expect(await readTaskAwaitingCi(1)).toBe(true);
    transitionFindFirst.mockResolvedValue({ cause: 'review_hold' });
    expect(await readTaskAwaitingCi(1)).toBe(false);
  });
});

describe('isQueueItemHandedBack', () => {
  test('a completed awaiting_ci item (by id) → true', async () => {
    itemFindUnique.mockResolvedValue({ status: 'completed', currentPhase: 'awaiting_ci' });
    expect(await isQueueItemHandedBack(5)).toBe(true);
    expect(itemFindUnique.mock.calls[0][0]).toEqual({
      where: { id: 5 },
      select: { status: true, currentPhase: true },
    });
  });
  test.each([
    ['still running', { status: 'running', currentPhase: 'awaiting_ci' }],
    ['another completed phase', { status: 'completed', currentPhase: 'awaiting_merge' }],
    ['missing', null],
  ])('%s → false', async (_n, item) => {
    itemFindUnique.mockResolvedValue(item);
    expect(await isQueueItemHandedBack(5)).toBe(false);
  });
  test('a read error → false', async () => {
    itemFindUnique.mockRejectedValue(new Error('db'));
    expect(await isQueueItemHandedBack(5)).toBe(false);
  });
});

describe('isItemStillOwned', () => {
  test('a running item still belongs to its runner', async () => {
    itemFindUnique.mockResolvedValue({ status: 'running' });
    expect(await isItemStillOwned(5)).toBe(true);
  });
  test.each([['completed'], ['cancelled'], ['queued'], ['failed'], ['waiting_approval']])(
    'a %s item no longer belongs to its runner',
    async (status) => {
      itemFindUnique.mockResolvedValue({ status });
      expect(await isItemStillOwned(5)).toBe(false);
    },
  );
  test('a missing row or a read error is NOT ownership (fail-closed)', async () => {
    itemFindUnique.mockResolvedValue(null);
    expect(await isItemStillOwned(5)).toBe(false);
    itemFindUnique.mockRejectedValue(new Error('db'));
    expect(await isItemStillOwned(5)).toBe(false);
  });
});

describe('listAwaitingCi', () => {
  test('lists released tasks that still wait, once each, with the latest cause', async () => {
    taskFindMany.mockResolvedValue([
      { id: 7, title: 'seven', updatedAt: new Date('2026-11-27T01:00:00Z') },
    ]);
    taskFindUnique.mockImplementation(async (a: unknown) => {
      const sel = (a as { select: Record<string, boolean> }).select;
      return sel.title ? { title: 'seven' } : held;
    });
    expect(await listAwaitingCi(3)).toEqual([
      {
        taskId: 7,
        title: 'seven',
        cause: 'verify_awaiting_required_merge',
        since: '2026-11-27T01:00:00.000Z',
      },
    ]);
  });
  test('a handed-back task that left the wait (merged / repairing) is dropped', async () => {
    taskFindMany.mockResolvedValue([{ id: 7, title: 'seven', updatedAt: new Date() }]);
    taskFindUnique.mockResolvedValue({
      status: 'done',
      workflowStatus: 'completed',
      haltReason: null,
    });
    expect(await listAwaitingCi(3)).toEqual([]);
  });
  test('nothing released / read error → empty list', async () => {
    expect(await listAwaitingCi(3)).toEqual([]);
    taskFindMany.mockRejectedValue(new Error('db'));
    expect(await listAwaitingCi(3)).toEqual([]);
  });
});
