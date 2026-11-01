/**
 * calendar-shares-handlers
 *
 * Grant, revoke, list, and the one read that crosses a workspace boundary:
 * fetching the schedule events of someone who shared their month calendar.
 *
 * Every dependency is injected so the refusal paths — and the workspace the
 * read actually happens in — are driven by unit tests rather than trusted.
 * NOT responsible for HTTP; the route layer maps these outcomes to statuses.
 */
import {
  decideCalendarShareAccess,
  type CalendarShareRefusal,
} from '../../../services/tenancy/calendar-share/calendar-share-access';
import {
  grantCalendarAccess,
  hasCalendarGrant,
  listGrantsFromOwner,
  listGrantsToViewer,
  revokeCalendarAccess,
  type CalendarShareDelegate,
  type GrantOutcome,
} from '../../../services/tenancy/calendar-share/calendar-share-store';
import type {
  PersonLabel,
  ResolvedPerson,
} from '../../../services/tenancy/calendar-share/calendar-share-people';

/**
 * One schedule event as a viewer may see it.
 *
 * This is the whole contract of what sharing exposes. `description` is
 * deliberately absent — it can hold private notes and the month view does
 * not render it — as are `taskId` and `reminderMinutes`. Tasks are out of
 * scope entirely (confirmed with the user 2026-10-30), so widening this
 * shape is a product decision, not a refactor.
 */
export interface SharedScheduleEvent {
  id: number;
  title: string;
  startAt: Date;
  endAt: Date | null;
  isAllDay: boolean;
  color: string;
  type: string;
}

/** A person shown in the share lists / picker. */
export interface SharePerson extends PersonLabel {
  workspaceId: number;
}

/** Injected collaborators. */
export interface CalendarShareDeps {
  shares: CalendarShareDelegate;
  resolvePerson: (identifier: string) => Promise<ResolvedPerson | null>;
  describePeople: (workspaceIds: number[]) => Promise<Map<number, PersonLabel>>;
  runInWorkspace: <T>(workspaceId: number, fn: () => Promise<T>) => Promise<T>;
  /** Called INSIDE the owner's scope; must read only schedule events. */
  listSchedules: (range: { from: Date; to: Date }) => Promise<SharedScheduleEvent[]>;
}

/** Why a share operation was refused. */
export type ShareRefusal = CalendarShareRefusal | 'unknown_person' | 'self';

export type SharedSchedulesResult =
  | { ok: true; events: SharedScheduleEvent[] }
  | { ok: false; reason: CalendarShareRefusal };

export type ShareListResult =
  | { ok: true; sharedByMe: SharePerson[]; sharedWithMe: SharePerson[] }
  | { ok: false; reason: 'no_session' };

export type AddShareResult =
  | { ok: true; outcome: GrantOutcome; person: SharePerson }
  | { ok: false; reason: ShareRefusal };

export type RemoveShareResult = { ok: true; removed: number } | { ok: false; reason: 'no_session' };

/** Keep only the agreed fields, whatever the reader handed back. */
function project(event: SharedScheduleEvent): SharedScheduleEvent {
  return {
    id: event.id,
    title: event.title,
    startAt: event.startAt,
    endAt: event.endAt,
    isAllDay: event.isAllDay,
    color: event.color,
    type: event.type,
  };
}

/**
 * Read one workspace's schedule events for the given window.
 *
 * Refuses with a reason rather than returning an empty list: a viewer with no
 * grant and a month with no events would otherwise look identical, which is
 * how a broken check survives being tested by hand.
 *
 * The read runs inside `ownerWorkspaceId`, NOT the caller's workspace — the
 * scope layer filters by whatever is current, so without this the endpoint
 * would cheerfully return the caller their own calendar under someone else's
 * name.
 *
 * @param deps - Injected collaborators / 注入する依存
 * @param params - Caller, target and window / 呼び出し元・対象・期間
 * @returns The events, or a refusal with its reason / 予定、または理由付きの拒否
 */
export async function readSharedSchedules(
  deps: CalendarShareDeps,
  params: {
    viewerWorkspaceId: number | null;
    ownerWorkspaceId: number;
    from: Date;
    to: Date;
  },
): Promise<SharedSchedulesResult> {
  // The grant lookup is skipped entirely for a sessionless caller: there is
  // no viewer to look one up for, and asking would imply there could be.
  const hasGrant =
    params.viewerWorkspaceId === null
      ? false
      : await hasCalendarGrant(deps.shares, {
          ownerWorkspaceId: params.ownerWorkspaceId,
          viewerWorkspaceId: params.viewerWorkspaceId,
        });
  const decision = decideCalendarShareAccess({
    viewerWorkspaceId: params.viewerWorkspaceId,
    ownerWorkspaceId: params.ownerWorkspaceId,
    hasGrant,
  });
  if (!decision.allowed) return { ok: false, reason: decision.reason };
  const events = await deps.runInWorkspace(params.ownerWorkspaceId, () =>
    deps.listSchedules({ from: params.from, to: params.to }),
  );
  return { ok: true, events: events.map(project) };
}

/**
 * Both directions of sharing for one workspace.
 *
 * @param deps - Injected collaborators / 注入する依存
 * @param viewerWorkspaceId - The caller's workspace / 呼び出し元のワークスペース
 * @returns Who they show, who shows them / 見せている相手と見せてくれる相手
 */
export async function listCalendarShares(
  deps: CalendarShareDeps,
  viewerWorkspaceId: number | null,
): Promise<ShareListResult> {
  if (viewerWorkspaceId === null) return { ok: false, reason: 'no_session' };
  const [granted, received] = await Promise.all([
    listGrantsFromOwner(deps.shares, viewerWorkspaceId),
    listGrantsToViewer(deps.shares, viewerWorkspaceId),
  ]);
  // Each row names two workspaces; the interesting one is always the party
  // that is not the caller.
  const byMe = granted.map((row) => row.viewerWorkspaceId);
  const withMe = received.map((row) => row.ownerWorkspaceId);
  const labels = await deps.describePeople([...new Set([...byMe, ...withMe])]);
  const toPeople = (ids: number[]): SharePerson[] =>
    ids
      .map((workspaceId) => {
        const label = labels.get(workspaceId);
        return label ? { workspaceId, ...label } : null;
      })
      .filter((p): p is SharePerson => p !== null);
  return { ok: true, sharedByMe: toPeople(byMe), sharedWithMe: toPeople(withMe) };
}

/**
 * Let the named person view the caller's calendar.
 *
 * @param deps - Injected collaborators / 注入する依存
 * @param ownerWorkspaceId - The caller, who is doing the sharing / 共有する側（呼び出し元）
 * @param identifier - Username or email of the person to share with / 相手のユーザー名またはメールアドレス
 * @returns The grant outcome, or a refusal / 付与結果、または拒否
 */
export async function addCalendarShare(
  deps: CalendarShareDeps,
  ownerWorkspaceId: number | null,
  identifier: string,
): Promise<AddShareResult> {
  if (ownerWorkspaceId === null) return { ok: false, reason: 'no_session' };
  const person = await deps.resolvePerson(identifier);
  if (!person) return { ok: false, reason: 'unknown_person' };
  const outcome = await grantCalendarAccess(deps.shares, {
    ownerWorkspaceId,
    viewerWorkspaceId: person.workspaceId,
  });
  if (outcome === 'self') return { ok: false, reason: 'self' };
  return {
    ok: true,
    outcome,
    person: { workspaceId: person.workspaceId, username: person.username, email: person.email },
  };
}

/**
 * Stop letting a workspace view the caller's calendar.
 *
 * @param deps - Injected collaborators / 注入する依存
 * @param ownerWorkspaceId - The caller, who granted it / 付与した側（呼び出し元）
 * @param viewerWorkspaceId - Whose access to remove / 取り消す相手
 * @returns How many grants went away / 取り消した件数
 */
export async function removeCalendarShare(
  deps: CalendarShareDeps,
  ownerWorkspaceId: number | null,
  viewerWorkspaceId: number,
): Promise<RemoveShareResult> {
  if (ownerWorkspaceId === null) return { ok: false, reason: 'no_session' };
  const removed = await revokeCalendarAccess(deps.shares, {
    ownerWorkspaceId,
    viewerWorkspaceId,
  });
  return { ok: true, removed };
}
