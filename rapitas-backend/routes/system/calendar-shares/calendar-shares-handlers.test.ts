/**
 * calendar-shares-handlers unit
 *
 * The cross-tenant read lives here, so this file carries the tests that would
 * catch a leak: refusing without a grant, refusing without a session, reading
 * inside the OWNER's scope rather than the caller's, and never widening the
 * payload past what sharing was agreed to expose.
 *
 * A refusal must be a refusal, not an empty list. An empty list is
 * indistinguishable from "no events that month", which is exactly how a
 * broken check would survive a manual test.
 */
import { describe, it, expect } from 'bun:test';
import {
  addCalendarShare,
  listCalendarShares,
  readSharedSchedules,
  removeCalendarShare,
  type CalendarShareDeps,
} from './calendar-shares-handlers';
import type { CalendarShareDelegate } from '../../../services/tenancy/calendar-share/calendar-share-store';

const RANGE = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-30T23:59:59Z') };

const EVENT = {
  id: 11,
  title: '定例会議',
  startAt: new Date('2026-11-04T01:00:00Z'),
  endAt: new Date('2026-11-04T02:00:00Z'),
  isAllDay: false,
  color: '#6366F1',
  type: 'GENERAL',
};

function deps(opts: {
  grant?: boolean;
  rows?: { id: number; ownerWorkspaceId: number; viewerWorkspaceId: number; createdAt: Date }[];
  person?: { workspaceId: number; userId: number; username: string; email: string | null } | null;
  events?: (typeof EVENT)[];
}) {
  const scopes: number[] = [];
  // The double honours `where`. A double that returned every row regardless
  // made the listing test pass on rows the real query would have excluded —
  // it reported the caller as one of its own shared-with people.
  type Pair = { ownerWorkspaceId?: number; viewerWorkspaceId?: number };
  const matching = (where: Pair) =>
    (opts.rows ?? []).filter(
      (row) =>
        (where.ownerWorkspaceId === undefined ||
          row.ownerWorkspaceId === where.ownerWorkspaceId) &&
        (where.viewerWorkspaceId === undefined ||
          row.viewerWorkspaceId === where.viewerWorkspaceId),
    );
  const shares = {
    findFirst: async () => (opts.grant ? { id: 1 } : null),
    findMany: async (args: { where: Pair }) => matching(args.where),
    create: async (args: { data: { ownerWorkspaceId: number; viewerWorkspaceId: number } }) => ({
      id: 1,
      ...args.data,
      createdAt: new Date(),
    }),
    deleteMany: async (args: { where: Pair }) => ({ count: matching(args.where).length }),
  } as unknown as CalendarShareDelegate;

  const d: CalendarShareDeps = {
    shares,
    resolvePerson: async () => opts.person ?? null,
    describePeople: async (ids) =>
      new Map(ids.map((id) => [id, { username: `w${id}`, email: null }])),
    runInWorkspace: async (workspaceId, fn) => {
      scopes.push(workspaceId);
      return fn();
    },
    listSchedules: async () => opts.events ?? [],
  };
  return { d, scopes };
}

describe('readSharedSchedules', () => {
  it('refuses a caller with no session', async () => {
    const { d, scopes } = deps({ grant: true, events: [EVENT] });
    const result = await readSharedSchedules(d, {
      viewerWorkspaceId: null,
      ownerWorkspaceId: 1,
      ...RANGE,
    });
    expect(result).toEqual({ ok: false, reason: 'no_session' });
    // Nothing may be read before the identity is known.
    expect(scopes).toEqual([]);
  });

  it('refuses a caller holding no grant', async () => {
    const { d, scopes } = deps({ grant: false, events: [EVENT] });
    const result = await readSharedSchedules(d, {
      viewerWorkspaceId: 2,
      ownerWorkspaceId: 1,
      ...RANGE,
    });
    expect(result).toEqual({ ok: false, reason: 'not_shared' });
    expect(scopes).toEqual([]);
  });

  it('reads inside the owner workspace, not the caller', async () => {
    // The whole point of the feature, and the one place a wrong id would
    // return the caller's own calendar while looking like it worked.
    const { d, scopes } = deps({ grant: true, events: [EVENT] });
    const result = await readSharedSchedules(d, {
      viewerWorkspaceId: 2,
      ownerWorkspaceId: 1,
      ...RANGE,
    });
    expect(result.ok).toBe(true);
    expect(scopes).toEqual([1]);
  });

  it('lets a workspace read its own calendar', async () => {
    const { d, scopes } = deps({ grant: false, events: [EVENT] });
    const result = await readSharedSchedules(d, {
      viewerWorkspaceId: 7,
      ownerWorkspaceId: 7,
      ...RANGE,
    });
    expect(result.ok).toBe(true);
    expect(scopes).toEqual([7]);
  });

  it('exposes only the fields sharing was agreed to show', async () => {
    // Confirmed with the user 2026-10-30: schedule events, no tasks. Within
    // an event, `description` can hold private notes and is NOT part of what
    // the month view needs, so it must not travel.
    const { d } = deps({ grant: true, events: [EVENT] });
    const result = await readSharedSchedules(d, {
      viewerWorkspaceId: 2,
      ownerWorkspaceId: 1,
      ...RANGE,
    });
    if (!result.ok) throw new Error('expected a readable calendar');
    expect(Object.keys(result.events[0]).sort()).toEqual([
      'color',
      'endAt',
      'id',
      'isAllDay',
      'startAt',
      'title',
      'type',
    ]);
  });

  it('refuses a junk owner id', async () => {
    const { d } = deps({ grant: true, events: [EVENT] });
    const result = await readSharedSchedules(d, {
      viewerWorkspaceId: 2,
      ownerWorkspaceId: Number.NaN,
      ...RANGE,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_owner' });
  });
});

describe('listCalendarShares', () => {
  it('refuses without a session', async () => {
    const { d } = deps({});
    expect(await listCalendarShares(d, null)).toEqual({ ok: false, reason: 'no_session' });
  });

  it('separates who I show from who shows me', async () => {
    const rows = [
      { id: 1, ownerWorkspaceId: 5, viewerWorkspaceId: 8, createdAt: new Date() },
      { id: 2, ownerWorkspaceId: 3, viewerWorkspaceId: 5, createdAt: new Date() },
    ];
    const { d } = deps({ rows });
    const result = await listCalendarShares(d, 5);
    if (!result.ok) throw new Error('expected a listing');
    // Row 1: 5 shows 8. Row 2: 3 shows 5. Each side must name the OTHER
    // party — reporting workspace 5 in either list would be the caller
    // appearing among their own contacts.
    expect(result.sharedByMe.map((p) => p.workspaceId)).toEqual([8]);
    expect(result.sharedWithMe.map((p) => p.workspaceId)).toEqual([3]);
  });
});

describe('addCalendarShare', () => {
  it('refuses without a session', async () => {
    const { d } = deps({ person: { workspaceId: 9, userId: 1, username: 'x', email: null } });
    expect(await addCalendarShare(d, null, 'x')).toEqual({ ok: false, reason: 'no_session' });
  });

  it('reports an unknown person instead of failing silently', async () => {
    const { d } = deps({ person: null });
    expect(await addCalendarShare(d, 5, 'nobody')).toEqual({ ok: false, reason: 'unknown_person' });
  });

  it('records the caller as owner and the named person as viewer', async () => {
    const { d } = deps({ person: { workspaceId: 9, userId: 1, username: 'mika', email: null } });
    const result = await addCalendarShare(d, 5, 'mika');
    expect(result).toEqual({
      ok: true,
      outcome: 'created',
      person: { workspaceId: 9, username: 'mika', email: null },
    });
  });

  it('refuses to share with yourself', async () => {
    const { d } = deps({ person: { workspaceId: 5, userId: 1, username: 'me', email: null } });
    expect(await addCalendarShare(d, 5, 'me')).toEqual({ ok: false, reason: 'self' });
  });
});

describe('removeCalendarShare', () => {
  it('refuses without a session', async () => {
    const { d } = deps({});
    expect(await removeCalendarShare(d, null, 9)).toEqual({ ok: false, reason: 'no_session' });
  });

  it('revokes only a grant the caller owns', async () => {
    const { d } = deps({ rows: [{ id: 1, ownerWorkspaceId: 5, viewerWorkspaceId: 9, createdAt: new Date() }] });
    expect(await removeCalendarShare(d, 5, 9)).toEqual({ ok: true, removed: 1 });
  });

  it('treats revoking an absent grant as done', async () => {
    const { d } = deps({ rows: [] });
    expect(await removeCalendarShare(d, 5, 9)).toEqual({ ok: true, removed: 0 });
  });
});
