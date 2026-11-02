/**
 * calendar-share-access
 *
 * The authorization decision for reading another workspace's month calendar.
 * Pure — no database and no request object, so every branch is testable and
 * the rules live in one readable place.
 *
 * NOT responsible for finding the grant: the caller looks that up in the
 * direction it is reading (owner → viewer) and passes the answer in. Keeping
 * the lookup out of here is deliberate — a predicate that queried would make
 * the direction an implementation detail instead of the caller's stated
 * intent.
 */

/** Why a calendar read was refused. */
export type CalendarShareRefusal = 'no_session' | 'not_shared' | 'invalid_owner';

/** The outcome of an access check. */
export type CalendarShareDecision =
  | { allowed: true }
  | { allowed: false; reason: CalendarShareRefusal };

/**
 * Whether this caller may read `ownerWorkspaceId`'s calendar.
 *
 * Fails CLOSED on a missing session, which is the opposite of how the rest of
 * this app behaves: unauthenticated requests are served unscoped on purpose
 * (guest-first), so "no workspace" is the ordinary state here rather than an
 * error. Inheriting that default on a sharing endpoint would hand a
 * sessionless caller someone else's calendar, so the identity check comes
 * first and no amount of grant evidence substitutes for it.
 *
 * @param params.viewerWorkspaceId - The caller's workspace, or null with no session / 閲覧者のワークスペース（セッション無しならnull）
 * @param params.ownerWorkspaceId - Whose calendar is being read / 読み出し対象のワークスペース
 * @param params.hasGrant - Whether a grant owner→viewer exists / owner→viewer の許可が存在するか
 * @returns Allowed, or refused with a reason / 許可、または理由付きの拒否
 */
export function decideCalendarShareAccess(params: {
  viewerWorkspaceId: number | null;
  ownerWorkspaceId: number;
  hasGrant: boolean;
}): CalendarShareDecision {
  if (params.viewerWorkspaceId === null) return { allowed: false, reason: 'no_session' };
  if (!Number.isInteger(params.ownerWorkspaceId) || params.ownerWorkspaceId <= 0) {
    return { allowed: false, reason: 'invalid_owner' };
  }
  // Your own calendar needs no grant. The UI passes the selected person's id
  // uniformly, and that selection includes "me".
  if (params.ownerWorkspaceId === params.viewerWorkspaceId) return { allowed: true };
  if (params.hasGrant) return { allowed: true };
  return { allowed: false, reason: 'not_shared' };
}
