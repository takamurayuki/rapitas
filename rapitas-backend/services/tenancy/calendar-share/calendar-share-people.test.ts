/**
 * calendar-share-people unit
 *
 * Turning a typed-in person into a workspace id is the step where sharing can
 * go to the WRONG account, so the matching rules are pinned rather than left
 * to whatever the query happens to do. In particular: an empty or blank
 * identifier must never match, and a user with no workspace must not resolve
 * to the default one — that workspace holds every pre-tenancy row.
 */
import { describe, it, expect } from 'bun:test';
import { describePeople, resolvePersonWorkspace, type PeopleDb } from './calendar-share-people';

function db(opts: {
  user?: { id: number; username: string; email: string | null } | null;
  membership?: { workspaceId: number } | null;
  members?: { workspaceId: number; user: { username: string; email: string | null } }[];
}): { db: PeopleDb; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    db: {
      user: {
        findFirst: async (args: { where: unknown }) => {
          calls.push({ op: 'user.findFirst', where: args.where });
          return opts.user ?? null;
        },
      },
      workspaceMember: {
        findFirst: async (args: { where: unknown }) => {
          calls.push({ op: 'member.findFirst', where: args.where });
          return opts.membership ?? null;
        },
        findMany: async (args: { where: unknown }) => {
          calls.push({ op: 'member.findMany', where: args.where });
          return opts.members ?? [];
        },
      },
    } as unknown as PeopleDb,
  };
}

describe('resolvePersonWorkspace', () => {
  it('resolves a person to their own workspace', async () => {
    const { db: d } = db({
      user: { id: 4, username: 'mika', email: 'mika@example.com' },
      membership: { workspaceId: 9 },
    });
    expect(await resolvePersonWorkspace(d, 'mika')).toEqual({
      workspaceId: 9,
      userId: 4,
      username: 'mika',
      email: 'mika@example.com',
    });
  });

  it('matches either the username or the email', async () => {
    const { db: d, calls } = db({
      user: { id: 4, username: 'mika', email: 'mika@example.com' },
      membership: { workspaceId: 9 },
    });
    await resolvePersonWorkspace(d, 'mika@example.com');
    expect(calls[0].where).toEqual({
      OR: [{ username: 'mika@example.com' }, { email: 'mika@example.com' }],
    });
  });

  it('trims the identifier before matching', async () => {
    const { db: d, calls } = db({
      user: { id: 4, username: 'mika', email: null },
      membership: { workspaceId: 9 },
    });
    await resolvePersonWorkspace(d, '  mika \n');
    expect(calls[0].where).toEqual({ OR: [{ username: 'mika' }, { email: 'mika' }] });
  });

  it.each(['', '   ', '\t\n'])('refuses the blank identifier %p without querying', async (id) => {
    // An empty string would otherwise match a row whose email is '' and share
    // the calendar with whoever that is.
    const { db: d, calls } = db({ user: { id: 1, username: 'x', email: '' } });
    expect(await resolvePersonWorkspace(d, id)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('returns null for an unknown person', async () => {
    const { db: d } = db({ user: null });
    expect(await resolvePersonWorkspace(d, 'nobody')).toBeNull();
  });

  it('returns null when the person has no workspace of their own', async () => {
    // Never fall back to the default workspace: it owns every pre-tenancy
    // row, so sharing it would expose the whole original pile.
    const { db: d } = db({
      user: { id: 4, username: 'mika', email: null },
      membership: null,
    });
    expect(await resolvePersonWorkspace(d, 'mika')).toBeNull();
  });
});

describe('describePeople', () => {
  it('labels each workspace with its owner', async () => {
    const { db: d } = db({
      members: [
        { workspaceId: 9, user: { username: 'mika', email: 'mika@example.com' } },
        { workspaceId: 3, user: { username: 'ren', email: null } },
      ],
    });
    const labels = await describePeople(d, [9, 3]);
    expect(labels.get(9)).toEqual({ username: 'mika', email: 'mika@example.com' });
    expect(labels.get(3)).toEqual({ username: 'ren', email: null });
  });

  it('asks for nothing when given no ids', async () => {
    const { db: d, calls } = db({});
    expect((await describePeople(d, [])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it('omits a workspace with no member rather than inventing a name', async () => {
    const { db: d } = db({ members: [] });
    expect((await describePeople(d, [9])).has(9)).toBe(false);
  });
});
