/**
 * calendar-store
 *
 * The single access path to the CalendarBusyBlock / CalendarSyncState models
 * (task 1174) plus the calendar_slot.* ActivityLog writes. Every other module
 * calls the typed functions below, so the cast for the not-yet-regenerated
 * Prisma client lives in exactly one place. DB errors never escape: reads
 * return [] / null and writes return false, so the gate fails open even
 * before the server restart that creates the tables. Not responsible for
 * deciding a hold or fetching from Google.
 */
import { createLogger } from '../../../config/logger';
import type { BusyBlock } from './free-slot';

const log = createLogger('calendar-store');

const SYNC_STATE_ID = 1;

/** Persisted poller status (single CalendarSyncState row). */
export interface CalendarSyncStateRecord {
  lastSyncedAt: Date | null;
  lastStatus: 'never' | 'ok' | 'error';
  lastError: string | null;
}

interface CalendarBusyBlockDelegate {
  deleteMany(args: object): Promise<unknown>;
  createMany(args: {
    data: Array<{ startAt: Date; endAt: Date; fetchedAt: Date }>;
  }): Promise<unknown>;
  findMany(args: object): Promise<Array<{ startAt: Date; endAt: Date }>>;
}

interface CalendarSyncStateDelegate {
  upsert(args: object): Promise<unknown>;
  findUnique(args: object): Promise<CalendarSyncStateRecord | null>;
}

interface CalendarDb {
  calendarBusyBlock: CalendarBusyBlockDelegate;
  calendarSyncState: CalendarSyncStateDelegate;
  activityLog: {
    create(args: { data: { taskId: null; action: string; metadata: string } }): Promise<unknown>;
  };
  $transaction(ops: Promise<unknown>[]): Promise<unknown>;
}

/**
 * The Prisma client narrowed to the calendar models.
 *
 * NOTE: CalendarBusyBlock / CalendarSyncState were added to
 * prisma/schema/schedule.prisma; the generated client gains them only after
 * the next server restart (CLAUDE.md forbids running prisma generate). The
 * client itself is cast — not `prisma.calendarBusyBlock` — because that
 * property access is a TS2339 error until regeneration. Same `as unknown as`
 * idiom as halt-release.ts. Lazily imported so merely loading the gate never
 * opens a Prisma client.
 */
async function db(): Promise<CalendarDb> {
  const { prisma } = await import('../../../config/database');
  return prisma as unknown as CalendarDb;
}

/**
 * Replace every stored busy block with `blocks` in one transaction.
 *
 * @param blocks - Busy blocks (times only) / 予定区間（時刻のみ）
 * @param fetchedAt - When they were fetched / 取得時刻
 * @returns false when the DB write failed / 書き込み失敗時は false
 */
export async function replaceBusyBlocks(blocks: BusyBlock[], fetchedAt: Date): Promise<boolean> {
  try {
    const p = await db();
    await p.$transaction([
      p.calendarBusyBlock.deleteMany({}),
      p.calendarBusyBlock.createMany({
        data: blocks.map((b) => ({ startAt: b.startAt, endAt: b.endAt, fetchedAt })),
      }),
    ]);
    return true;
  } catch (err) {
    log.warn({ err }, '[calendar-store] replaceBusyBlocks failed');
    return false;
  }
}

/**
 * Stored busy blocks, ordered by start.
 *
 * @returns Busy blocks, or [] when the DB is unreadable / 予定区間（読めなければ空）
 */
export async function listBusyBlocks(): Promise<BusyBlock[]> {
  try {
    const rows = await (
      await db()
    ).calendarBusyBlock.findMany({
      select: { startAt: true, endAt: true },
      orderBy: { startAt: 'asc' },
    });
    return rows.map((r) => ({ startAt: r.startAt, endAt: r.endAt }));
  } catch (err) {
    log.warn({ err }, '[calendar-store] listBusyBlocks failed');
    return [];
  }
}

/**
 * The poller status row.
 *
 * @returns Status, or null when absent / unreadable / 同期状態（無ければ null）
 */
export async function getSyncState(): Promise<CalendarSyncStateRecord | null> {
  try {
    return await (
      await db()
    ).calendarSyncState.findUnique({
      where: { id: SYNC_STATE_ID },
      select: { lastSyncedAt: true, lastStatus: true, lastError: true },
    });
  } catch (err) {
    log.warn({ err }, '[calendar-store] getSyncState failed');
    return null;
  }
}

/**
 * Upsert the poller status row.
 *
 * @param state - New status / 新しい同期状態
 * @returns false when the DB write failed / 書き込み失敗時は false
 */
export async function saveSyncState(state: CalendarSyncStateRecord): Promise<boolean> {
  try {
    await (
      await db()
    ).calendarSyncState.upsert({
      where: { id: SYNC_STATE_ID },
      create: { id: SYNC_STATE_ID, ...state },
      update: state,
    });
    return true;
  } catch (err) {
    log.warn({ err }, '[calendar-store] saveSyncState failed');
    return false;
  }
}

/**
 * Append a calendar_slot.* ActivityLog row (the dashboard's execution log).
 *
 * @param action - calendar_slot.* action / アクション名
 * @param metadata - JSON metadata (times and ids only) / メタデータ
 */
export async function recordCalendarActivity(
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await (
      await db()
    ).activityLog.create({
      data: { taskId: null, action, metadata: JSON.stringify(metadata) },
    });
  } catch (err) {
    log.warn({ err, action }, '[calendar-store] failed to record activity');
  }
}
