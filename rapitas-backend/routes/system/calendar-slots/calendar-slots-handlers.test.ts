/**
 * calendar-slots-handlers.test
 *
 * AC6 (task 1174): the dashboard API returns the next run schedule, the
 * calendar-slot execution log, and the sync state (incl. error / stale /
 * never synced), all read through calendar-store; the OAuth callback rejects
 * an unknown CSRF state and stores the refresh token only through the token
 * store.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// The dashboard reads busy blocks and the poller status through calendar-store.
type SyncState = {
  lastSyncedAt: Date | null;
  lastStatus: 'never' | 'ok' | 'error';
  lastError: string | null;
};
let syncState: SyncState | null = null;
let busyBlocks: Array<{ startAt: Date; endAt: Date }> = [];
mock.module('../../../services/scheduling/calendar-slot/calendar-store', () => ({
  getSyncState: mock(async () => syncState),
  listBusyBlocks: mock(async () => busyBlocks),
  replaceBusyBlocks: mock(async () => true),
  saveSyncState: mock(async () => true),
  recordCalendarActivity: mock(async () => {}),
}));

const {
  buildNextRuns,
  buildSyncState,
  listSlotLogs,
  createOAuthState,
  completeCalendarOAuth,
  resetOAuthStates,
} = await import('./calendar-slots-handlers');
const { markCalendarHold, resetCalendarHoldState } =
  await import('../../../services/scheduling/calendar-slot/calendar-hold-state');
const { MemoryCalendarTokenStore } =
  await import('../../../services/scheduling/calendar-slot/token-store');

const at = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00.000Z`);
const saved = { ...process.env };

beforeEach(() => {
  syncState = null;
  busyBlocks = [];
  resetCalendarHoldState();
  resetOAuthStates();
  process.env.RAPITAS_CALENDAR_GATE_ENABLED = 'true';
  process.env.RAPITAS_CALENDAR_LEAD_MINUTES = '10';
  process.env.RAPITAS_CALENDAR_POLL_MINUTES = '5';
});

afterEach(() => {
  process.env = { ...saved };
});

describe('buildNextRuns', () => {
  it('returns the next run time, free slots and active holds from the stored calendar', async () => {
    busyBlocks = [{ startAt: at('10:00'), endAt: at('11:00') }];
    syncState = { lastSyncedAt: at('09:55'), lastStatus: 'ok', lastError: null };
    markCalendarHold(3, at('11:00'));
    const r = await buildNextRuns(at('09:55'));
    expect(r.enabled).toBe(true);
    expect(r.leadMinutes).toBe(10);
    expect(r.nextRunAt).toBe(at('11:00').toISOString());
    expect(r.gate).toEqual({
      hold: true,
      reason: 'pre_meeting',
      releaseAt: at('11:00').toISOString(),
    });
    // Free from the meeting end to the end of the 7-day fetch horizon.
    expect(r.freeSlots).toEqual([
      {
        startAt: at('11:00').toISOString(),
        endAt: new Date(at('09:55').getTime() + 7 * 86_400_000).toISOString(),
      },
    ]);
    expect(r.busyBlocks).toEqual([
      { startAt: at('10:00').toISOString(), endAt: at('11:00').toISOString() },
    ]);
    expect(r.holds).toEqual([{ themeId: 3, releaseAt: at('11:00').toISOString() }]);
    // AC1: the API exposes times only.
    expect(Object.keys(r.busyBlocks[0]!)).toEqual(['startAt', 'endAt']);
  });

  it('reports no hold and no blocks when the calendar is unusable (fail-open)', async () => {
    busyBlocks = [{ startAt: at('10:00'), endAt: at('11:00') }];
    syncState = { lastSyncedAt: at('10:25'), lastStatus: 'error', lastError: 'invalid_grant' };
    const r = await buildNextRuns(at('10:30'));
    expect(r.gate.hold).toBe(false);
    expect(r.nextRunAt).toBe(at('10:30').toISOString());
    expect(r.busyBlocks).toEqual([]);
  });
});

describe('buildSyncState', () => {
  it('flags a stale sync and surfaces the last error', async () => {
    syncState = { lastSyncedAt: at('09:00'), lastStatus: 'error', lastError: 'boom' };
    const s = await buildSyncState(at('09:30'), true);
    expect(s).toMatchObject({
      enabled: true,
      connected: true,
      lastStatus: 'error',
      lastError: 'boom',
      stale: true,
      pollMinutes: 5,
      lastSyncedAt: at('09:00').toISOString(),
    });
  });

  it('is fresh right after a successful sync', async () => {
    syncState = { lastSyncedAt: at('09:28'), lastStatus: 'ok', lastError: null };
    expect((await buildSyncState(at('09:30'), false)).stale).toBe(false);
  });

  it('reports never / stale when no sync row exists yet (before the first poll)', async () => {
    expect(await buildSyncState(at('09:30'), false)).toMatchObject({
      lastStatus: 'never',
      lastSyncedAt: null,
      lastError: null,
      stale: true,
    });
  });
});

describe('listSlotLogs', () => {
  it('pages calendar_slot.* activity rows newest first and parses metadata', async () => {
    const findMany = mock(async (_args: unknown) => [
      {
        id: 9,
        action: 'calendar_slot.hold_started',
        metadata: '{"themeId":1,"reason":"pre_meeting"}',
        createdAt: at('09:50'),
      },
      { id: 8, action: 'calendar_slot.recomputed', metadata: 'not json', createdAt: at('09:45') },
    ]);
    const count = mock(async (_args: unknown) => 12);
    const r = await listSlotLogs({ findMany, count }, 2, 10);
    const args = findMany.mock.calls[0]![0] as {
      where: { action: { startsWith: string } };
      skip: number;
      take: number;
      orderBy: { createdAt: string };
    };
    expect(args.where).toEqual({ action: { startsWith: 'calendar_slot.' } });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(args.orderBy).toEqual({ createdAt: 'desc' });
    expect(r.total).toBe(12);
    expect(r.items[0]).toEqual({
      id: 9,
      action: 'calendar_slot.hold_started',
      metadata: { themeId: 1, reason: 'pre_meeting' },
      createdAt: at('09:50').toISOString(),
    });
    expect(r.items[1]!.metadata).toEqual({});
  });
});

describe('completeCalendarOAuth', () => {
  it('rejects an unknown state without exchanging the code', async () => {
    const exchange = mock(async () => ({ refresh_token: 'rt' }));
    const store = new MemoryCalendarTokenStore();
    const r = await completeCalendarOAuth(
      { code: 'c', state: 'forged' },
      { exchange, tokenStore: store, triggerSync: async () => {} },
    );
    expect(r).toBe('invalid_state');
    expect(exchange).not.toHaveBeenCalled();
    expect(store.get()).toBeNull();
  });

  it('stores the refresh token via the token store and triggers a sync', async () => {
    const state = createOAuthState();
    const store = new MemoryCalendarTokenStore();
    const triggerSync = mock(async () => {});
    const r = await completeCalendarOAuth(
      { code: 'c', state },
      { exchange: async () => ({ refresh_token: 'rt-1' }), tokenStore: store, triggerSync },
    );
    expect(r).toBe('connected');
    expect(store.get()).toBe('rt-1');
    expect(triggerSync).toHaveBeenCalledTimes(1);
    // A state is single-use.
    const again = await completeCalendarOAuth(
      { code: 'c', state },
      { exchange: async () => ({ refresh_token: 'rt-2' }), tokenStore: store, triggerSync },
    );
    expect(again).toBe('invalid_state');
  });

  it('reports no_refresh_token when Google omits it', async () => {
    const state = createOAuthState();
    const r = await completeCalendarOAuth(
      { code: 'c', state },
      {
        exchange: async () => ({ refresh_token: null }),
        tokenStore: new MemoryCalendarTokenStore(),
        triggerSync: async () => {},
      },
    );
    expect(r).toBe('no_refresh_token');
  });
});
