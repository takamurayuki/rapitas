/**
 * calendar-sync-service.test
 *
 * AC5 (task 1174): polling detects a schedule change and recomputes the
 * slots only when the busy set actually changed; a failed fetch or a failed
 * store write degrades to lastStatus='error' (recorded, never thrown). All
 * persistence goes through calendar-store, mocked here (DB / Google free).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { BusyBlock } from './free-slot';
import type { CalendarSyncStateRecord } from './calendar-store';

const NOW = new Date('2026-10-12T09:00:00.000Z');
const b = (s: string, e: string): BusyBlock => ({
  startAt: new Date(`2026-10-12T${s}:00.000Z`),
  endAt: new Date(`2026-10-12T${e}:00.000Z`),
});

let storedBlocks: BusyBlock[] = [];
let storedState: CalendarSyncStateRecord | null = null;
let replaceOk = true;
const replaced: BusyBlock[][] = [];
const states: CalendarSyncStateRecord[] = [];
const activity: Array<{ action: string; metadata: Record<string, unknown> }> = [];

mock.module('./calendar-store', () => ({
  replaceBusyBlocks: mock(async (blocks: BusyBlock[]) => {
    replaced.push(blocks);
    if (replaceOk) storedBlocks = blocks;
    return replaceOk;
  }),
  listBusyBlocks: mock(async () => storedBlocks),
  getSyncState: mock(async () => storedState),
  saveSyncState: mock(async (s: CalendarSyncStateRecord) => {
    states.push(s);
    storedState = s;
    return true;
  }),
  recordCalendarActivity: mock(async (action: string, metadata: Record<string, unknown>) => {
    activity.push({ action, metadata });
  }),
}));

const { CalendarSyncService } = await import('./calendar-sync-service');

function svc(fetchBusy: () => Promise<BusyBlock[]>) {
  return new CalendarSyncService({ fetchBusy, now: () => NOW, leadMinutes: 10 });
}

beforeEach(() => {
  storedBlocks = [];
  storedState = null;
  replaceOk = true;
  replaced.length = 0;
  states.length = 0;
  activity.length = 0;
});

describe('CalendarSyncService.syncOnce', () => {
  it('stores blocks and records calendar_slot.recomputed on the first sync', async () => {
    const r = await svc(async () => [b('10:00', '11:00')]).syncOnce();
    expect(r).toEqual({ status: 'ok', changed: true });
    expect(replaced).toEqual([[b('10:00', '11:00')]]);
    expect(activity.map((a) => a.action)).toEqual(['calendar_slot.recomputed']);
    expect(activity[0]!.metadata.nextRunAt).toBe(NOW.toISOString());
    expect(states.at(-1)).toEqual({ lastStatus: 'ok', lastError: null, lastSyncedAt: NOW });
  });

  it('does not recompute when the busy set is unchanged, and does when it changes', async () => {
    let current = [b('10:00', '11:00')];
    const s = svc(async () => current);
    await s.syncOnce();
    expect((await s.syncOnce()).changed).toBe(false);
    expect(replaced.length).toBe(1);

    current = [b('10:30', '11:30')];
    expect((await s.syncOnce()).changed).toBe(true);
    expect(replaced.length).toBe(2);
    expect(activity.filter((a) => a.action === 'calendar_slot.recomputed').length).toBe(2);
    expect(storedBlocks).toEqual([b('10:30', '11:30')]);
  });

  it('degrades to lastStatus=error without throwing and logs the failure once', async () => {
    const s = svc(async () => {
      throw new Error('invalid_grant ' + 'x'.repeat(1000));
    });
    expect(await s.syncOnce()).toEqual({ status: 'error', changed: false });
    expect((await s.syncOnce()).status).toBe('error');
    const last = states.at(-1)!;
    expect(last.lastStatus).toBe('error');
    expect(last.lastError).toContain('invalid_grant');
    expect(last.lastError!.length).toBeLessThanOrEqual(500);
    expect(activity.filter((a) => a.action === 'calendar_slot.sync_failed').length).toBe(1);
  });

  it('treats blocks already in the store as the baseline (no spurious recompute after restart)', async () => {
    storedBlocks = [b('10:00', '11:00')];
    storedState = { lastSyncedAt: NOW, lastStatus: 'ok', lastError: null };
    const r = await svc(async () => [b('10:00', '11:00')]).syncOnce();
    expect(r.changed).toBe(false);
    expect(replaced.length).toBe(0);
  });

  it('reports error (gate fails open) when the store write fails, e.g. before the restart', async () => {
    replaceOk = false;
    const r = await svc(async () => [b('10:00', '11:00')]).syncOnce();
    expect(r.status).toBe('error');
    expect(states.at(-1)!.lastStatus).toBe('error');
    expect(states.at(-1)!.lastError).toContain('busy blocks');
  });
});

describe('CalendarSyncService.start / stop', () => {
  it('syncs immediately on start, is idempotent, and stops cleanly', async () => {
    let fetches = 0;
    const s = svc(async () => {
      fetches++;
      return [];
    });
    s.start(5);
    s.start(5);
    await new Promise((r) => setTimeout(r, 20));
    s.stop();
    expect(fetches).toBe(1);
    expect(storedState?.lastStatus).toBe('ok');
  });
});
