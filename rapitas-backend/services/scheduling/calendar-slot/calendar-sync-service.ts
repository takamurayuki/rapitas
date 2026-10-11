/**
 * calendar-sync-service
 *
 * Polls Google FreeBusy (task 1174, AC5), replaces the stored busy blocks
 * when the schedule changed, and publishes the snapshot the auto-run calendar
 * gate reads. Failures never throw: they are recorded as lastStatus='error'
 * so the gate fails open. Webhook push is intentionally not implemented — the
 * Tauri build cannot receive public HTTPS callbacks. Not responsible for the
 * hold decision (free-slot.ts) or the OAuth exchange (calendar-slots routes).
 */
import { createLogger } from '../../../config/logger';
import { computeNextRunAt, mergeBusyBlocks, type BusyBlock } from './free-slot';
import { getCalendarSlotSettings, updateCalendarSnapshot } from './calendar-hold-state';

const log = createLogger('calendar-sync-service');

/** Days of calendar fetched per poll. */
export const CALENDAR_HORIZON_DAYS = 7;
const MAX_ERROR_LENGTH = 500;

/** Persisted sync status (CalendarSyncState row). */
export interface CalendarSyncStateRecord {
  lastSyncedAt: Date | null;
  lastStatus: 'ok' | 'error';
  lastError: string | null;
}

/** Persistence port; the Prisma adapter is createPrismaCalendarSlotStore. */
export interface CalendarSlotStore {
  replaceBusyBlocks(blocks: BusyBlock[], fetchedAt: Date): Promise<void>;
  loadBusyBlocks(): Promise<BusyBlock[]>;
  saveSyncState(state: CalendarSyncStateRecord): Promise<void>;
  loadSyncState(): Promise<CalendarSyncStateRecord | null>;
  recordActivity(action: string, metadata: Record<string, unknown>): Promise<void>;
}

export interface CalendarSyncDeps {
  store: CalendarSlotStore;
  fetchBusy: (timeMin: Date, timeMax: Date) => Promise<BusyBlock[]>;
  now?: () => Date;
  leadMinutes?: number;
}

function fingerprint(blocks: readonly BusyBlock[]): string {
  return blocks.map((b) => `${b.startAt.toISOString()}/${b.endAt.toISOString()}`).join('|');
}

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, MAX_ERROR_LENGTH);
}

/** Poller + change detector for the calendar busy set. */
export class CalendarSyncService {
  private readonly deps: CalendarSyncDeps;
  private baseline: string | null = null;
  private lastStatus: 'ok' | 'error' | null = null;
  private lastSyncedAt: Date | null = null;
  private neverComputed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(deps: CalendarSyncDeps) {
    this.deps = deps;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private leadMinutes(): number {
    return this.deps.leadMinutes ?? getCalendarSlotSettings().leadMinutes;
  }

  /**
   * Fetch once, recompute the slots if the busy set changed, and publish the snapshot.
   *
   * @returns Sync outcome; never throws / 同期結果（例外を投げない）
   */
  async syncOnce(): Promise<{ status: 'ok' | 'error'; changed: boolean }> {
    const now = this.now();
    const horizonEnd = new Date(now.getTime() + CALENDAR_HORIZON_DAYS * 86_400_000);
    try {
      if (this.baseline === null) {
        const stored = await this.deps.store.loadBusyBlocks().catch(() => []);
        this.baseline = fingerprint(mergeBusyBlocks(stored));
        const state = await this.deps.store.loadSyncState().catch(() => null);
        this.lastStatus = state?.lastStatus ?? null;
        this.lastSyncedAt = state?.lastSyncedAt ?? null;
        this.neverComputed = stored.length === 0 && state === null;
      }
      const blocks = mergeBusyBlocks(await this.deps.fetchBusy(now, horizonEnd));
      const fp = fingerprint(blocks);
      // The very first sync with nothing stored still counts as a change so the
      // dashboard log shows when the slots were first computed.
      const changed = fp !== this.baseline || this.neverComputed;
      if (changed) {
        await this.deps.store.replaceBusyBlocks(blocks, now);
        const nextRunAt = computeNextRunAt({
          now,
          busyBlocks: blocks,
          leadMinutes: this.leadMinutes(),
          horizon: horizonEnd,
        });
        await this.deps.store
          .recordActivity('calendar_slot.recomputed', {
            blockCount: blocks.length,
            nextRunAt: nextRunAt?.toISOString() ?? null,
          })
          .catch((err) => log.warn({ err }, '[calendar-sync] failed to record recompute'));
        this.baseline = fp;
        this.neverComputed = false;
      }
      await this.deps.store.saveSyncState({ lastSyncedAt: now, lastStatus: 'ok', lastError: null });
      this.lastStatus = 'ok';
      this.lastSyncedAt = now;
      updateCalendarSnapshot({
        busyBlocks: blocks,
        lastSyncedAt: now,
        lastStatus: 'ok',
        lastError: null,
        horizonEnd,
      });
      return { status: 'ok', changed };
    } catch (err) {
      const message = errorText(err);
      log.warn({ err: message }, '[calendar-sync] sync failed — calendar gate fails open');
      const wasError = this.lastStatus === 'error';
      this.lastStatus = 'error';
      updateCalendarSnapshot({ lastStatus: 'error', lastError: message });
      await this.deps.store
        .saveSyncState({ lastSyncedAt: this.lastSyncedAt, lastStatus: 'error', lastError: message })
        .catch(() => {});
      // Only the ok→error transition is logged so a disconnected calendar does
      // not write an ActivityLog row every poll.
      if (!wasError) {
        await this.deps.store
          .recordActivity('calendar_slot.sync_failed', { error: message })
          .catch(() => {});
      }
      return { status: 'error', changed: false };
    }
  }

  /**
   * Start polling (immediate first sync). Idempotent.
   *
   * @param pollMinutes - Interval in minutes / ポーリング間隔(分)
   */
  start(pollMinutes: number): void {
    if (this.timer) return;
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.syncOnce();
      } finally {
        this.running = false;
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), pollMinutes * 60_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Narrow Prisma surface for the two new models (generated client lags until restart). */
interface CalendarPrismaLike {
  calendarBusyBlock: {
    deleteMany(args: object): Promise<unknown>;
    createMany(args: {
      data: Array<{ startAt: Date; endAt: Date; fetchedAt: Date }>;
    }): Promise<unknown>;
    findMany(args: object): Promise<Array<{ startAt: Date; endAt: Date }>>;
  };
  calendarSyncState: {
    upsert(args: object): Promise<unknown>;
    findUnique(args: object): Promise<CalendarSyncStateRecord | null>;
  };
  activityLog: {
    create(args: { data: { taskId: null; action: string; metadata: string } }): Promise<unknown>;
  };
  $transaction(ops: Promise<unknown>[]): Promise<unknown>;
}

const SYNC_STATE_ID = 1;

/**
 * Prisma-backed store. CalendarBusyBlock / CalendarSyncState were just added
 * to prisma/schema/schedule.prisma — the generated client is pending regen
 * until the next server restart (CLAUDE.md forbids running prisma generate),
 * so the client is narrowed to the shape used here.
 *
 * @param prisma - Prisma client / Prisma クライアント
 * @returns Store adapter / ストアアダプタ
 */
export function createPrismaCalendarSlotStore(prisma: unknown): CalendarSlotStore {
  const p = prisma as CalendarPrismaLike;
  return {
    replaceBusyBlocks: async (blocks, fetchedAt) => {
      await p.$transaction([
        p.calendarBusyBlock.deleteMany({}),
        p.calendarBusyBlock.createMany({
          data: blocks.map((b) => ({ startAt: b.startAt, endAt: b.endAt, fetchedAt })),
        }),
      ]);
    },
    loadBusyBlocks: async () =>
      (
        await p.calendarBusyBlock.findMany({
          select: { startAt: true, endAt: true },
          orderBy: { startAt: 'asc' },
        })
      ).map((r) => ({ startAt: r.startAt, endAt: r.endAt })),
    saveSyncState: async (state) => {
      await p.calendarSyncState.upsert({
        where: { id: SYNC_STATE_ID },
        create: { id: SYNC_STATE_ID, ...state },
        update: state,
      });
    },
    loadSyncState: async () =>
      p.calendarSyncState.findUnique({
        where: { id: SYNC_STATE_ID },
        select: { lastSyncedAt: true, lastStatus: true, lastError: true },
      }),
    recordActivity: async (action, metadata) => {
      await p.activityLog.create({
        data: { taskId: null, action, metadata: JSON.stringify(metadata) },
      });
    },
  };
}
