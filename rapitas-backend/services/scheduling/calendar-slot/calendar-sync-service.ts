/**
 * calendar-sync-service
 *
 * Polls Google FreeBusy (task 1174, AC5) and, when the schedule changed,
 * replaces the stored busy blocks and records the recompute. All persistence
 * goes through calendar-store.ts. Failures never throw: they are recorded as
 * lastStatus='error' so the gate fails open. Webhook push is intentionally
 * not implemented — the Tauri build cannot receive public HTTPS callbacks.
 * Not responsible for the hold decision (calendar-hold-decision.ts) or the
 * OAuth exchange (calendar-slots routes).
 */
import { createLogger } from '../../../config/logger';
import { computeNextRunAt, mergeBusyBlocks, type BusyBlock } from './free-slot';
import { getCalendarSlotSettings } from './calendar-hold-state';
import {
  getSyncState,
  listBusyBlocks,
  recordCalendarActivity,
  replaceBusyBlocks,
  saveSyncState,
} from './calendar-store';

const log = createLogger('calendar-sync-service');

/** Days of calendar fetched per poll. */
export const CALENDAR_HORIZON_DAYS = 7;
const MAX_ERROR_LENGTH = 500;

export interface CalendarSyncDeps {
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
  private lastStatus: 'never' | 'ok' | 'error' | null = null;
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
   * Fetch once and recompute the slots if the busy set changed.
   *
   * @returns Sync outcome; never throws / 同期結果（例外を投げない）
   */
  async syncOnce(): Promise<{ status: 'ok' | 'error'; changed: boolean }> {
    const now = this.now();
    const horizonEnd = new Date(now.getTime() + CALENDAR_HORIZON_DAYS * 86_400_000);
    try {
      if (this.baseline === null) {
        const stored = await listBusyBlocks();
        this.baseline = fingerprint(mergeBusyBlocks(stored));
        const state = await getSyncState();
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
        if (!(await replaceBusyBlocks(blocks, now))) {
          throw new Error('failed to store busy blocks');
        }
        const nextRunAt = computeNextRunAt({
          now,
          busyBlocks: blocks,
          leadMinutes: this.leadMinutes(),
          horizon: horizonEnd,
        });
        await recordCalendarActivity('calendar_slot.recomputed', {
          blockCount: blocks.length,
          nextRunAt: nextRunAt?.toISOString() ?? null,
        });
        this.baseline = fp;
        this.neverComputed = false;
      }
      await saveSyncState({ lastSyncedAt: now, lastStatus: 'ok', lastError: null });
      this.lastStatus = 'ok';
      this.lastSyncedAt = now;
      return { status: 'ok', changed };
    } catch (err) {
      const message = errorText(err);
      log.warn({ err: message }, '[calendar-sync] sync failed — calendar gate fails open');
      const wasError = this.lastStatus === 'error';
      this.lastStatus = 'error';
      await saveSyncState({
        lastSyncedAt: this.lastSyncedAt,
        lastStatus: 'error',
        lastError: message,
      });
      // Only the ok→error transition is logged so a disconnected calendar does
      // not write an ActivityLog row every poll.
      if (!wasError) await recordCalendarActivity('calendar_slot.sync_failed', { error: message });
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
