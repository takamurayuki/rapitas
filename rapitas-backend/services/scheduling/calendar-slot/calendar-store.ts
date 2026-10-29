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

// NOTE: the row used to be addressed as `id: 1`, which the model's
// `@id @default(1)` invited. Under workspace scoping that cannot work — the
// scope layer adds `workspaceId` to the where, so a second workspace's write
// missed and then tried to CREATE id=1 again, colliding with the first
// workspace's row. The failure was caught and logged at warn, so the status
// silently never persisted for anyone but the default workspace. Every access
// below is find-then-write instead, letting the scope layer choose the row
// and stamp the owner.

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
  findFirst(args: object): Promise<({ id: number } & Partial<CalendarSyncStateRecord>) | null>;
  update(args: { where: { id: number }; data: CalendarSyncStateRecord }): Promise<unknown>;
  create(args: { data: CalendarSyncStateRecord }): Promise<unknown>;
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
 * This workspace's poller status row.
 *
 * @returns Status, or null when absent / unreadable / 同期状態（無ければ null）
 */
export async function getSyncState(): Promise<CalendarSyncStateRecord | null> {
  try {
    const row = await (
      await db()
    ).calendarSyncState.findFirst({
      select: { lastSyncedAt: true, lastStatus: true, lastError: true },
    });
    if (!row) return null;
    return {
      lastSyncedAt: row.lastSyncedAt ?? null,
      lastStatus: row.lastStatus ?? 'never',
      lastError: row.lastError ?? null,
    };
  } catch (err) {
    log.warn({ err }, '[calendar-store] getSyncState failed');
    return null;
  }
}

/**
 * Write this workspace's poller status row, creating it on first use.
 *
 * @param state - New status / 新しい同期状態
 * @returns false when the DB write failed / 書き込み失敗時は false
 */
export async function saveSyncState(state: CalendarSyncStateRecord): Promise<boolean> {
  try {
    const client = await db();
    const existing = await client.calendarSyncState.findFirst({ select: { id: true } });
    if (existing) {
      await client.calendarSyncState.update({ where: { id: existing.id }, data: state });
    } else {
      // No id and no workspaceId: the column default assigns the one, the
      // scope layer stamps the other.
      await client.calendarSyncState.create({ data: state });
    }
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
