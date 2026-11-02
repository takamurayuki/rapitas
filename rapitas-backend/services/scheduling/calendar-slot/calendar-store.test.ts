/**
 * calendar-store.test
 *
 * calendar-store.ts is the ONLY access path to CalendarBusyBlock /
 * CalendarSyncState (task 1174, plan §Prisma 生成クライアントと tsc の両立):
 * replace = deleteMany then createMany in one transaction, times only (AC1);
 * DB errors never throw (reads → [] / null, writes → false). A source scan
 * pins that no other calendar-slot file touches the new models directly.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const calls: string[] = [];
let fail = false;
const at = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00.000Z`);
const guard = <T>(name: string, value: T) =>
  mock(async (_args?: unknown) => {
    calls.push(name);
    if (fail) throw new Error('no such table: CalendarBusyBlock');
    return value;
  });

const deleteMany = guard('deleteMany', { count: 1 });
const createMany = guard('createMany', { count: 1 });
const findMany = guard('findMany', [{ startAt: at('10:00'), endAt: at('11:00') }]);
const upsert = guard('upsert', {});
let existingSyncStateId: number | null = 7;
const syncFindFirst = mock(async (_args?: unknown) => {
  calls.push('syncFindFirst');
  if (fail) throw new Error('no such table: CalendarSyncState');
  // One delegate serves both calls with different `select`s, so the double
  // returns the id AND the status fields rather than guessing which call it is.
  return existingSyncStateId === null
    ? null
    : {
        id: existingSyncStateId,
        lastSyncedAt: at('09:55'),
        lastStatus: 'ok' as const,
        lastError: null,
      };
});
const syncUpdate = guard('syncUpdate', {});
const syncCreate = guard('syncCreate', {});
const findUnique = guard('findUnique', {
  lastSyncedAt: at('09:55'),
  lastStatus: 'ok',
  lastError: null,
});
const activityCreate = guard('activityCreate', {});

mock.module('../../../config/database', () => ({
  prisma: {
    calendarBusyBlock: { deleteMany, createMany, findMany },
    calendarSyncState: {
      upsert,
      findUnique,
      findFirst: syncFindFirst,
      update: syncUpdate,
      create: syncCreate,
    },
    activityLog: { create: activityCreate },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const store = await import('./calendar-store');

beforeEach(() => {
  calls.length = 0;
  fail = false;
  existingSyncStateId = 7;
  for (const m of [
    deleteMany,
    createMany,
    findMany,
    upsert,
    findUnique,
    activityCreate,
    syncFindFirst,
    syncUpdate,
    syncCreate,
  ]) {
    m.mockClear();
  }
});

describe('calendar-store', () => {
  it('replaceBusyBlocks deletes then creates once, with times only', async () => {
    const ok = await store.replaceBusyBlocks(
      [{ startAt: at('10:00'), endAt: at('11:00') }],
      at('09:55'),
    );
    expect(ok).toBe(true);
    expect(calls).toEqual(['deleteMany', 'createMany']);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledTimes(1);
    const data = (createMany.mock.calls[0]![0] as { data: Array<Record<string, unknown>> }).data;
    expect(data).toEqual([{ startAt: at('10:00'), endAt: at('11:00'), fetchedAt: at('09:55') }]);
    expect(Object.keys(data[0]!)).toEqual(['startAt', 'endAt', 'fetchedAt']);
  });

  it('listBusyBlocks returns start/end only, ordered by start', async () => {
    expect(await store.listBusyBlocks()).toEqual([{ startAt: at('10:00'), endAt: at('11:00') }]);
    expect(findMany.mock.calls[0]![0]).toEqual({
      select: { startAt: true, endAt: true },
      orderBy: { startAt: 'asc' },
    });
  });

  it('saveSyncState writes the row it found and getSyncState reads it back', async () => {
    const state = { lastSyncedAt: at('09:55'), lastStatus: 'error' as const, lastError: 'x' };
    expect(await store.saveSyncState(state)).toBe(true);
    // Keyed on the row the scope layer picked, not on a literal id — see the
    // NOTE in calendar-store.ts for what the literal broke.
    expect(syncUpdate.mock.calls[0]![0]).toEqual({ where: { id: 7 }, data: state });
    expect(await store.getSyncState()).toEqual({
      lastSyncedAt: at('09:55'),
      lastStatus: 'ok',
      lastError: null,
    });
  });

  it('recordCalendarActivity writes a JSON ActivityLog row', async () => {
    await store.recordCalendarActivity('calendar_slot.recomputed', { blockCount: 1 });
    expect(activityCreate.mock.calls[0]![0]).toEqual({
      data: { taskId: null, action: 'calendar_slot.recomputed', metadata: '{"blockCount":1}' },
    });
  });

  it('never throws on DB errors (table missing before restart): reads empty, writes false', async () => {
    fail = true;
    expect(await store.listBusyBlocks()).toEqual([]);
    expect(await store.getSyncState()).toBeNull();
    expect(await store.replaceBusyBlocks([], at('09:55'))).toBe(false);
    expect(
      await store.saveSyncState({ lastSyncedAt: null, lastStatus: 'error', lastError: null }),
    ).toBe(false);
    await expect(store.recordCalendarActivity('calendar_slot.x', {})).resolves.toBeUndefined();
  });

  it('is the only calendar-slot module that touches the new Prisma models', () => {
    const dir = import.meta.dir;
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'calendar-store.ts')
      .filter((f) =>
        /prisma\.calendar|calendarBusyBlock|calendarSyncState/.test(
          readFileSync(join(dir, f), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});

/**
 * One sync-state row per workspace.
 *
 * The row was addressed as `id: 1` — a literal, because the model declares
 * `@id @default(1)` as a single-row table. Under workspace scoping that is
 * unworkable: the scope layer adds `workspaceId` to the where, so a second
 * workspace's upsert misses and then CREATEs id=1 again, colliding with the
 * first workspace's row. The write failed, was caught, logged at warn and
 * reported as `false` — the status silently never persisted for anyone but
 * the default workspace. Find-then-write lets the scope layer pick the row
 * and stamp the owner.
 */
describe('saveSyncState is per workspace', () => {
  const state = { lastSyncedAt: at('09:00'), lastStatus: 'ok' as const, lastError: null };

  it('never addresses the row by a hard-coded id', async () => {
    expect(await store.saveSyncState(state)).toBe(true);
    expect(calls).not.toContain('upsert');
    for (const call of syncUpdate.mock.calls as unknown as [{ where: { id: number } }][]) {
      expect(call[0].where.id).toBe(7);
    }
  });

  it('updates the row this workspace already has', async () => {
    await store.saveSyncState(state);
    expect(calls).toEqual(['syncFindFirst', 'syncUpdate']);
    expect(syncCreate).not.toHaveBeenCalled();
  });

  it('creates one when this workspace has none, without choosing an id', async () => {
    existingSyncStateId = null;
    await store.saveSyncState(state);
    expect(calls).toEqual(['syncFindFirst', 'syncCreate']);
    const args = syncCreate.mock.calls[0]![0] as { data: Record<string, unknown> };
    // An explicit id is what collided across workspaces; the DB assigns it.
    expect(args.data).not.toHaveProperty('id');
    expect(args.data).not.toHaveProperty('workspaceId');
  });

  it('still reports false instead of throwing when the DB is unavailable', async () => {
    fail = true;
    expect(await store.saveSyncState(state)).toBe(false);
  });
});

describe('getSyncState is per workspace', () => {
  it('reads without a hard-coded id, so the scope layer picks the row', async () => {
    await store.getSyncState();
    expect(calls).toEqual(['syncFindFirst']);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
