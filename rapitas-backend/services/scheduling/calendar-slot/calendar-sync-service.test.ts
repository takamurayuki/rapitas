/**
 * calendar-sync-service.test
 *
 * AC5 (task 1174): polling detects a schedule change and recomputes the
 * slots only when the busy set actually changed; a failed fetch degrades to
 * lastStatus='error' (recorded, never thrown) and is DB/Google independent.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  CalendarSyncService,
  createPrismaCalendarSlotStore,
  type CalendarSlotStore,
} from './calendar-sync-service';
import { getCalendarSnapshot, resetCalendarHoldState } from './calendar-hold-state';
import type { BusyBlock } from './free-slot';

const NOW = new Date('2026-10-12T09:00:00.000Z');
const b = (s: string, e: string): BusyBlock => ({
  startAt: new Date(`2026-10-12T${s}:00.000Z`),
  endAt: new Date(`2026-10-12T${e}:00.000Z`),
});

function makeStore() {
  const calls = {
    replaced: [] as BusyBlock[][],
    states: [] as Array<{
      lastStatus: string;
      lastError: string | null;
      lastSyncedAt: Date | null;
    }>,
    activity: [] as Array<{ action: string; metadata: Record<string, unknown> }>,
  };
  const store: CalendarSlotStore = {
    replaceBusyBlocks: async (blocks) => {
      calls.replaced.push(blocks);
    },
    loadBusyBlocks: async () => [],
    saveSyncState: async (s) => {
      calls.states.push(s);
    },
    loadSyncState: async () => null,
    recordActivity: async (action, metadata) => {
      calls.activity.push({ action, metadata });
    },
  };
  return { store, calls };
}

describe('CalendarSyncService.syncOnce', () => {
  beforeEach(() => resetCalendarHoldState());

  it('stores blocks and records calendar_slot.recomputed on the first sync', async () => {
    const { store, calls } = makeStore();
    const svc = new CalendarSyncService({
      store,
      fetchBusy: async () => [b('10:00', '11:00')],
      now: () => NOW,
      leadMinutes: 10,
    });
    const r = await svc.syncOnce();
    expect(r).toEqual({ status: 'ok', changed: true });
    expect(calls.replaced).toEqual([[b('10:00', '11:00')]]);
    expect(calls.activity.map((a) => a.action)).toEqual(['calendar_slot.recomputed']);
    expect(calls.activity[0]!.metadata.nextRunAt).toBe(NOW.toISOString());
    expect(calls.states.at(-1)).toEqual({ lastStatus: 'ok', lastError: null, lastSyncedAt: NOW });
    const snap = getCalendarSnapshot();
    expect(snap.lastStatus).toBe('ok');
    expect(snap.busyBlocks).toEqual([b('10:00', '11:00')]);
  });

  it('does not recompute when the busy set is unchanged, and does when it changes', async () => {
    const { store, calls } = makeStore();
    let current = [b('10:00', '11:00')];
    const svc = new CalendarSyncService({
      store,
      fetchBusy: async () => current,
      now: () => NOW,
      leadMinutes: 10,
    });
    await svc.syncOnce();
    const second = await svc.syncOnce();
    expect(second.changed).toBe(false);
    expect(calls.replaced.length).toBe(1);

    current = [b('10:30', '11:30')];
    const third = await svc.syncOnce();
    expect(third.changed).toBe(true);
    expect(calls.replaced.length).toBe(2);
    expect(calls.activity.filter((a) => a.action === 'calendar_slot.recomputed').length).toBe(2);
    expect(getCalendarSnapshot().busyBlocks).toEqual([b('10:30', '11:30')]);
  });

  it('degrades to lastStatus=error without throwing and logs the failure once', async () => {
    const { store, calls } = makeStore();
    const svc = new CalendarSyncService({
      store,
      fetchBusy: async () => {
        throw new Error('invalid_grant ' + 'x'.repeat(1000));
      },
      now: () => NOW,
      leadMinutes: 10,
    });
    const r1 = await svc.syncOnce();
    const r2 = await svc.syncOnce();
    expect(r1).toEqual({ status: 'error', changed: false });
    expect(r2.status).toBe('error');
    const last = calls.states.at(-1)!;
    expect(last.lastStatus).toBe('error');
    expect(last.lastError).toContain('invalid_grant');
    expect(last.lastError!.length).toBeLessThanOrEqual(500);
    expect(calls.activity.filter((a) => a.action === 'calendar_slot.sync_failed').length).toBe(1);
    expect(getCalendarSnapshot().lastStatus).toBe('error');
  });

  it('treats blocks reloaded from the store as the baseline (no spurious recompute after restart)', async () => {
    const { store, calls } = makeStore();
    store.loadBusyBlocks = async () => [b('10:00', '11:00')];
    const svc = new CalendarSyncService({
      store,
      fetchBusy: async () => [b('10:00', '11:00')],
      now: () => NOW,
      leadMinutes: 10,
    });
    const r = await svc.syncOnce();
    expect(r.changed).toBe(false);
    expect(calls.replaced.length).toBe(0);
  });

  it('keeps succeeding when the store write fails (sync never throws)', async () => {
    const { store } = makeStore();
    store.replaceBusyBlocks = async () => {
      throw new Error('db down');
    };
    const svc = new CalendarSyncService({
      store,
      fetchBusy: async () => [b('10:00', '11:00')],
      now: () => NOW,
      leadMinutes: 10,
    });
    const r = await svc.syncOnce();
    expect(r.status).toBe('error');
    expect(getCalendarSnapshot().lastError).toContain('db down');
  });
});

describe('createPrismaCalendarSlotStore', () => {
  function fakePrisma() {
    const calls: Record<string, unknown[]> = {};
    const rec = (name: string, ret: unknown) => async (args: unknown) => {
      (calls[name] ??= []).push(args);
      return ret;
    };
    const prisma = {
      calendarBusyBlock: {
        deleteMany: rec('deleteMany', {}),
        createMany: rec('createMany', {}),
        findMany: rec('findMany', [
          { startAt: b('10:00', '11:00').startAt, endAt: b('10:00', '11:00').endAt },
        ]),
      },
      calendarSyncState: {
        upsert: rec('upsert', {}),
        findUnique: rec('findUnique', { lastSyncedAt: NOW, lastStatus: 'ok', lastError: null }),
      },
      activityLog: { create: rec('activityCreate', {}) },
      $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    return { prisma, calls };
  }

  it('replaces blocks in one transaction with times only (no title/attendee columns)', async () => {
    const { prisma, calls } = fakePrisma();
    const store = createPrismaCalendarSlotStore(prisma);
    await store.replaceBusyBlocks([b('10:00', '11:00')], NOW);
    expect(calls.deleteMany).toEqual([{}]);
    const data = (calls.createMany![0] as { data: Array<Record<string, unknown>> }).data;
    expect(data).toEqual([
      { startAt: b('10:00', '11:00').startAt, endAt: b('10:00', '11:00').endAt, fetchedAt: NOW },
    ]);
    expect(Object.keys(data[0]!)).toEqual(['startAt', 'endAt', 'fetchedAt']);
  });

  it('upserts the single sync-state row, reads it back, and records JSON activity', async () => {
    const { prisma, calls } = fakePrisma();
    const store = createPrismaCalendarSlotStore(prisma);
    await store.saveSyncState({ lastSyncedAt: NOW, lastStatus: 'error', lastError: 'boom' });
    expect(calls.upsert![0]).toMatchObject({
      where: { id: 1 },
      create: { id: 1, lastStatus: 'error', lastError: 'boom' },
      update: { lastStatus: 'error', lastError: 'boom' },
    });
    expect(await store.loadSyncState()).toEqual({
      lastSyncedAt: NOW,
      lastStatus: 'ok',
      lastError: null,
    });
    expect(await store.loadBusyBlocks()).toEqual([b('10:00', '11:00')]);
    await store.recordActivity('calendar_slot.recomputed', { blockCount: 1 });
    expect(calls.activityCreate![0]).toEqual({
      data: { taskId: null, action: 'calendar_slot.recomputed', metadata: '{"blockCount":1}' },
    });
  });
});

describe('CalendarSyncService.start / stop', () => {
  beforeEach(() => resetCalendarHoldState());

  it('syncs immediately on start, is idempotent, and stops cleanly', async () => {
    const { store } = makeStore();
    let fetches = 0;
    const svc = new CalendarSyncService({
      store,
      fetchBusy: async () => {
        fetches++;
        return [];
      },
      now: () => NOW,
      leadMinutes: 10,
    });
    svc.start(5);
    svc.start(5);
    await new Promise((r) => setTimeout(r, 20));
    svc.stop();
    expect(fetches).toBe(1);
    expect(getCalendarSnapshot().lastStatus).toBe('ok');
  });
});
