/**
 * dispatchable-queue-depth.test
 *
 * The restart gates must not count queued items that cannot run on their own
 * (paused theme), must still count the ones that can, and must never delete
 * anything (task 1562, 2026-11-26: item 4713 refused /deploy/now).
 */
import { describe, test, expect } from 'bun:test';
import { countDispatchableQueued } from './dispatchable-queue-depth';

const RECEIPT_AT = '2026-11-26T00:00:00.000Z';
const VALID_RECEIPT = JSON.stringify({
  repairResume: { updatedAt: RECEIPT_AT, workflowStatus: 'in_progress', executionId: null },
});

type Item = { id: number; status: string; themeId: number | null; result?: string | null };
type Run = { themeId: number; enabled: boolean; status: string };
type Clause = { themeId: null | { notIn: number[] } };

/** A just-enough stand-in for the two Prisma calls the count makes. */
function fakeDb(items: Item[], runs: Run[]) {
  const db = {
    themeAutoRun: {
      findFirst: async () => ({ enabled: false, status: 'idle' }),
      findMany: async () =>
        runs
          .filter((r) => !(r.enabled && r.status === 'running'))
          .map((r) => ({ themeId: r.themeId, enabled: r.enabled, status: r.status })),
    },
    workflowQueueItem: {
      findMany: async (args: { where: { themeId: { in: number[] } } }) =>
        items
          .filter(
            (i) =>
              i.status === 'queued' &&
              i.themeId !== null &&
              args.where.themeId.in.includes(i.themeId) &&
              i.result != null,
          )
          .map((i) => ({ taskId: i.id, result: i.result })),
      count: async (args: { where: { status: string; OR?: Clause[] } }) => {
        const { status, OR } = args.where;
        return items.filter((i) => {
          if (i.status !== status) return false;
          if (!OR) return true;
          return OR.some((c) =>
            c.themeId === null
              ? i.themeId === null
              : i.themeId !== null && !c.themeId.notIn.includes(i.themeId),
          );
        }).length;
      },
    },
    // What canAcquireRepairQueue reads: the task still matches the receipt, no execution, no stop.
    task: {
      findUnique: async () => ({
        status: 'in-progress',
        workflowStatus: 'in_progress',
        updatedAt: new Date(RECEIPT_AT),
        themeId: 1,
      }),
    },
    agentExecution: { findFirst: async () => null },
    workflowTransition: { findFirst: async () => null },
  };
  return db as unknown as Parameters<typeof countDispatchableQueued>[0];
}

describe('countDispatchableQueued', () => {
  test('every theme paused_user and only queued items → 0, and the items stay', async () => {
    const items: Item[] = [{ id: 4713, status: 'queued', themeId: 1 }];
    const runs: Run[] = [
      { themeId: 1, enabled: true, status: 'paused_user' },
      { themeId: 49, enabled: true, status: 'paused_user' },
    ];
    expect(await countDispatchableQueued(fakeDb(items, runs), false)).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0]!.status).toBe('queued');
  });

  test('a running theme with a queued item still counts (waits as before)', async () => {
    const items: Item[] = [{ id: 1, status: 'queued', themeId: 1 }];
    const runs: Run[] = [{ themeId: 1, enabled: true, status: 'running' }];
    expect(await countDispatchableQueued(fakeDb(items, runs), false)).toBe(1);
  });

  test('stopping and idle themes do not count; running themes beside them do', async () => {
    const items: Item[] = [
      { id: 1, status: 'queued', themeId: 1 },
      { id: 2, status: 'queued', themeId: 2 },
      { id: 3, status: 'queued', themeId: 3 },
      { id: 4, status: 'running', themeId: 3 },
    ];
    const runs: Run[] = [
      { themeId: 1, enabled: true, status: 'stopping' },
      { themeId: 2, enabled: false, status: 'idle' },
      { themeId: 3, enabled: true, status: 'running' },
    ];
    expect(await countDispatchableQueued(fakeDb(items, runs), false)).toBe(1);
  });

  test('items with no theme or no ThemeAutoRun row are counted (the safe side)', async () => {
    const items: Item[] = [
      { id: 1, status: 'queued', themeId: null },
      { id: 2, status: 'queued', themeId: 9 },
    ];
    const runs: Run[] = [{ themeId: 1, enabled: true, status: 'paused_user' }];
    expect(await countDispatchableQueued(fakeDb(items, runs), false)).toBe(2);
  });

  test('empty queue → 0', async () => {
    expect(await countDispatchableQueued(fakeDb([], []), false)).toBe(0);
  });

  test('during a restart wait everything queued is parked, so the count is 0', async () => {
    const items: Item[] = [{ id: 1, status: 'queued', themeId: 1 }];
    const runs: Run[] = [{ themeId: 1, enabled: true, status: 'running' }];
    expect(await countDispatchableQueued(fakeDb(items, runs), true)).toBe(0);
  });

  test('a verified repair of a stopped (idle, disabled) theme still counts: the guard dispatches it', async () => {
    const items: Item[] = [
      { id: 1, status: 'queued', themeId: 1, result: VALID_RECEIPT },
      { id: 2, status: 'queued', themeId: 1, result: '{"phase":"x"}' },
      { id: 3, status: 'queued', themeId: 1, result: null },
      { id: 4, status: 'queued', themeId: 1, result: '{not json' },
    ];
    const runs: Run[] = [{ themeId: 1, enabled: false, status: 'idle' }];
    expect(await countDispatchableQueued(fakeDb(items, runs), false)).toBe(1);
  });

  test('a repair receipt that dequeue would refuse does not count (missing fields, stale task)', async () => {
    const items: Item[] = [
      { id: 1, status: 'queued', themeId: 1, result: '{"repairResume":{"x":1}}' },
      {
        id: 2,
        status: 'queued',
        themeId: 1,
        result: JSON.stringify({
          repairResume: {
            updatedAt: '2020-01-01T00:00:00.000Z',
            workflowStatus: 'in_progress',
            executionId: null,
          },
        }),
      },
    ];
    const runs: Run[] = [{ themeId: 1, enabled: false, status: 'idle' }];
    expect(await countDispatchableQueued(fakeDb(items, runs), false)).toBe(0);
  });

  test('a repair-shaped result on a paused theme does not count (the guard only allows idle + disabled)', async () => {
    const items: Item[] = [{ id: 1, status: 'queued', themeId: 1, result: VALID_RECEIPT }];
    const runs: Run[] = [{ themeId: 1, enabled: true, status: 'paused_user' }];
    expect(await countDispatchableQueued(fakeDb(items, runs), false)).toBe(0);
  });
});
