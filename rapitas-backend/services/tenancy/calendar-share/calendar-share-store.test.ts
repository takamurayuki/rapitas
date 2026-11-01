/**
 * calendar-share-store unit
 *
 * Pins the direction of every query. A grant row means "owner is visible to
 * viewer", and the two lists read the SAME table from opposite ends — so a
 * swapped field here would quietly turn "who I show" into "who shows me" and
 * hand out access nobody granted. The doubles assert on the `where` they are
 * given rather than returning canned rows blindly.
 */
import { describe, it, expect } from 'bun:test';
import {
  grantCalendarAccess,
  hasCalendarGrant,
  listGrantsFromOwner,
  listGrantsToViewer,
  revokeCalendarAccess,
  type CalendarShareDelegate,
} from './calendar-share-store';

type Where = Record<string, unknown>;

/** Records what it was asked, so a test can assert the query's direction. */
function recorder(rows: unknown[] = []) {
  const calls: { op: string; where?: Where; data?: Where }[] = [];
  const delegate = {
    findFirst: async (args: { where: Where }) => {
      calls.push({ op: 'findFirst', where: args.where });
      return rows.length > 0 ? (rows[0] as { id: number }) : null;
    },
    findMany: async (args: { where: Where }) => {
      calls.push({ op: 'findMany', where: args.where });
      return rows as never[];
    },
    create: async (args: { data: Where }) => {
      calls.push({ op: 'create', data: args.data });
      return { id: 99, ...args.data } as never;
    },
    deleteMany: async (args: { where: Where }) => {
      calls.push({ op: 'deleteMany', where: args.where });
      return { count: rows.length };
    },
  } as unknown as CalendarShareDelegate;
  return { delegate, calls };
}

describe('hasCalendarGrant', () => {
  it('looks the grant up in the owner→viewer direction', async () => {
    const { delegate, calls } = recorder([{ id: 1 }]);
    expect(await hasCalendarGrant(delegate, { ownerWorkspaceId: 1, viewerWorkspaceId: 2 })).toBe(
      true,
    );
    expect(calls[0].where).toEqual({ ownerWorkspaceId: 1, viewerWorkspaceId: 2 });
  });

  it('reports no grant when the row is absent', async () => {
    const { delegate } = recorder([]);
    expect(await hasCalendarGrant(delegate, { ownerWorkspaceId: 1, viewerWorkspaceId: 2 })).toBe(
      false,
    );
  });

  it('reports no grant when the query throws', async () => {
    // Fail closed. A read error must not read as "shared".
    const broken = {
      findFirst: async () => {
        throw new Error('db down');
      },
    } as unknown as CalendarShareDelegate;
    expect(await hasCalendarGrant(broken, { ownerWorkspaceId: 1, viewerWorkspaceId: 2 })).toBe(
      false,
    );
  });
});

describe('listGrantsFromOwner', () => {
  it('filters on the owner side', async () => {
    const { delegate, calls } = recorder([]);
    await listGrantsFromOwner(delegate, 5);
    expect(calls[0].where).toEqual({ ownerWorkspaceId: 5 });
  });
});

describe('listGrantsToViewer', () => {
  it('filters on the viewer side', async () => {
    const { delegate, calls } = recorder([]);
    await listGrantsToViewer(delegate, 5);
    expect(calls[0].where).toEqual({ viewerWorkspaceId: 5 });
  });
});

describe('grantCalendarAccess', () => {
  it('creates the grant when none exists', async () => {
    const { delegate, calls } = recorder([]);
    expect(await grantCalendarAccess(delegate, { ownerWorkspaceId: 1, viewerWorkspaceId: 2 })).toBe(
      'created',
    );
    expect(calls.map((c) => c.op)).toEqual(['findFirst', 'create']);
    expect(calls[1].data).toEqual({ ownerWorkspaceId: 1, viewerWorkspaceId: 2 });
  });

  it('is idempotent when the grant is already there', async () => {
    // find-then-create rather than upsert: granting twice from two tabs must
    // not surface a unique-constraint error to the user.
    const { delegate, calls } = recorder([{ id: 1 }]);
    expect(await grantCalendarAccess(delegate, { ownerWorkspaceId: 1, viewerWorkspaceId: 2 })).toBe(
      'exists',
    );
    expect(calls.map((c) => c.op)).toEqual(['findFirst']);
  });

  it('refuses to share a calendar with itself', async () => {
    const { delegate, calls } = recorder([]);
    expect(await grantCalendarAccess(delegate, { ownerWorkspaceId: 3, viewerWorkspaceId: 3 })).toBe(
      'self',
    );
    expect(calls).toEqual([]);
  });
});

describe('revokeCalendarAccess', () => {
  it('deletes by both sides so one revoke cannot clear a neighbour', async () => {
    const { delegate, calls } = recorder([{ id: 1 }]);
    await revokeCalendarAccess(delegate, { ownerWorkspaceId: 1, viewerWorkspaceId: 2 });
    expect(calls[0].op).toBe('deleteMany');
    expect(calls[0].where).toEqual({ ownerWorkspaceId: 1, viewerWorkspaceId: 2 });
  });

  it('treats revoking an absent grant as done, not an error', async () => {
    const { delegate } = recorder([]);
    expect(
      await revokeCalendarAccess(delegate, { ownerWorkspaceId: 1, viewerWorkspaceId: 2 }),
    ).toBe(0);
  });
});
