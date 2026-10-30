/**
 * calendar-share-store
 *
 * Reads and writes CalendarShare rows: who may view whose month calendar.
 * Every function takes the delegate rather than reaching for the client, so
 * the direction of each query is pinned by a unit test instead of trusted.
 *
 * NOT responsible for deciding access — see calendar-share-access — nor for
 * reading the calendar itself.
 *
 * NOTE: CalendarShare deliberately has no `workspaceId` column, so the
 * workspace scope layer ignores this table and these queries see every row.
 * That is required: a grant must be readable from both ends, and the owner
 * and the viewer are by definition in different workspaces.
 */
import { createLogger } from '../../../config/logger';

const log = createLogger('calendar-share-store');

/** One grant row. */
export interface CalendarShareRow {
  id: number;
  ownerWorkspaceId: number;
  viewerWorkspaceId: number;
  createdAt: Date;
}

/** The pair that identifies a grant. */
export interface CalendarSharePair {
  ownerWorkspaceId: number;
  viewerWorkspaceId: number;
}

/**
 * The slice of `prisma.calendarShare` this module uses.
 *
 * Narrowed on purpose: it is what lets the tests drive these functions with a
 * double that asserts on the `where` it receives. It also keeps this module
 * compiling in a checkout whose generated client predates the model — agents
 * here cannot run `prisma generate` (dev.js owns it), so the delegate appears
 * only after the next server restart.
 */
export interface CalendarShareDelegate {
  findFirst(args: { where: CalendarSharePair }): Promise<{ id: number } | null>;
  findMany(args: {
    where: Partial<CalendarSharePair>;
    orderBy?: { createdAt: 'asc' | 'desc' };
  }): Promise<CalendarShareRow[]>;
  create(args: { data: CalendarSharePair }): Promise<CalendarShareRow>;
  deleteMany(args: { where: CalendarSharePair }): Promise<{ count: number }>;
}

/**
 * Whether `ownerWorkspaceId` has granted `viewerWorkspaceId` read access.
 *
 * Fails closed on a read error: an unreadable table must not read as shared.
 *
 * @param delegate - CalendarShare delegate / CalendarShare デリゲート
 * @param pair - The grant to look for, owner→viewer / 探す許可（owner→viewer）
 * @returns True only when the row exists / 行が存在する場合のみ true
 */
export async function hasCalendarGrant(
  delegate: CalendarShareDelegate,
  pair: CalendarSharePair,
): Promise<boolean> {
  try {
    return (await delegate.findFirst({ where: pair })) !== null;
  } catch (err) {
    log.warn({ err }, '[calendar-share] grant lookup failed — treating as not shared');
    return false;
  }
}

/**
 * Grants this workspace has handed out: "who I show my calendar to".
 *
 * @param delegate - CalendarShare delegate / CalendarShare デリゲート
 * @param ownerWorkspaceId - The sharing workspace / 共有している側
 * @returns Its grants, oldest first / その許可一覧（古い順）
 */
export async function listGrantsFromOwner(
  delegate: CalendarShareDelegate,
  ownerWorkspaceId: number,
): Promise<CalendarShareRow[]> {
  return delegate.findMany({ where: { ownerWorkspaceId }, orderBy: { createdAt: 'asc' } });
}

/**
 * Grants pointing at this workspace: "whose calendars I may see".
 *
 * @param delegate - CalendarShare delegate / CalendarShare デリゲート
 * @param viewerWorkspaceId - The viewing workspace / 閲覧する側
 * @returns Grants it holds, oldest first / 受けている許可一覧（古い順）
 */
export async function listGrantsToViewer(
  delegate: CalendarShareDelegate,
  viewerWorkspaceId: number,
): Promise<CalendarShareRow[]> {
  return delegate.findMany({ where: { viewerWorkspaceId }, orderBy: { createdAt: 'asc' } });
}

/** What a grant attempt did. */
export type GrantOutcome = 'created' | 'exists' | 'self';

/**
 * Grant read access, idempotently.
 *
 * find-then-create rather than `upsert`: granting the same pair twice (two
 * tabs, a double click) must read as success, not as a unique-constraint
 * error surfaced to the user.
 *
 * @param delegate - CalendarShare delegate / CalendarShare デリゲート
 * @param pair - Who shares with whom / 誰が誰に共有するか
 * @returns What happened / 実行結果
 */
export async function grantCalendarAccess(
  delegate: CalendarShareDelegate,
  pair: CalendarSharePair,
): Promise<GrantOutcome> {
  if (pair.ownerWorkspaceId === pair.viewerWorkspaceId) return 'self';
  const existing = await delegate.findFirst({ where: pair });
  if (existing) return 'exists';
  await delegate.create({ data: pair });
  return 'created';
}

/**
 * Revoke read access. Revoking a grant that is not there is success.
 *
 * Deletes by the owner AND viewer pair rather than by id, so a stale id from
 * a long-open settings page cannot remove a row the caller does not own.
 *
 * @param delegate - CalendarShare delegate / CalendarShare デリゲート
 * @param pair - The grant to remove / 取り消す許可
 * @returns How many rows went away / 削除された行数
 */
export async function revokeCalendarAccess(
  delegate: CalendarShareDelegate,
  pair: CalendarSharePair,
): Promise<number> {
  const { count } = await delegate.deleteMany({ where: pair });
  return count;
}
