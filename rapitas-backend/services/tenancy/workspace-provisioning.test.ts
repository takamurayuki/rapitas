/**
 * workspace-provisioning unit
 *
 * What happens when a SECOND account registers.
 *
 * This is the module that decides whether a new user gets a workspace of their
 * own, and it had no test: the gate that blocks merges executed none of its
 * functions. The behaviours that matter once there is more than one account
 * are slug collision (two people called the same thing) and idempotence (a
 * replayed registration must not split one user's data across two
 * workspaces).
 *
 * NOT responsible for what a session resolves to (session-workspace) or for
 * moving existing rows (workspace-backfill).
 */
import { describe, it, expect } from 'bun:test';
import {
  ensureWorkspaceForUser,
  ensureDefaultWorkspace,
  type ProvisioningDb,
} from './workspace-provisioning';

interface Stored {
  id: number;
  slug: string;
  name: string;
  isDefault: boolean;
  ownerId: number | null;
}

/** An in-memory stand-in that enforces the slug's uniqueness, as the DB does. */
function fakeDb(seed: Stored[] = []): { db: ProvisioningDb; rows: Stored[] } {
  const rows = [...seed];
  let nextId = rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  const db: ProvisioningDb = {
    workspace: {
      findUnique: async ({ where }) => rows.find((r) => r.slug === where.slug) ?? null,
      findFirst: async ({ where }) => {
        // Honours `select` like the real client: returning the whole stored
        // row would let a test pass on fields production never sees.
        const found = rows.find((r) => r.isDefault === where.isDefault);
        return found === undefined ? null : { id: found.id, slug: found.slug };
      },
      create: async ({ data, select }) => {
        const slug = data.slug as string;
        if (rows.some((r) => r.slug === slug)) throw new Error('slug already taken');
        const members = data.members as { create?: { userId: number } } | undefined;
        const row: Stored = {
          id: nextId++,
          slug,
          name: data.name as string,
          isDefault: (data.isDefault as boolean | undefined) ?? false,
          ownerId: members?.create?.userId ?? null,
        };
        rows.push(row);
        // Returns only the selected fields, as the real client does — the
        // default workspace is created with select {id, slug} and gets no
        // `name`, which is what makes it comparable to the findFirst result.
        const picked: Record<string, unknown> = {};
        for (const key of Object.keys(select)) picked[key] = row[key as keyof Stored];
        return picked as unknown as { id: number; slug: string; name: string };
      },
    },
    workspaceMember: {
      findFirst: async ({ where }) => {
        const owned = rows.filter((r) => r.ownerId === where.userId).sort((a, b) => a.id - b.id)[0];
        return owned === undefined
          ? null
          : { workspace: { id: owned.id, slug: owned.slug, name: owned.name } };
      },
    },
  };
  return { db, rows };
}

describe('a new account', () => {
  it('gets a workspace of its own, owned by it', async () => {
    const { db, rows } = fakeDb();
    const ws = await ensureWorkspaceForUser(1, 'yuki', db);
    expect(ws).toMatchObject({ slug: 'yuki', name: 'yuki' });
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerId).toBe(1);
  });

  it('is never given somebody else’s workspace', async () => {
    const { db } = fakeDb();
    const first = await ensureWorkspaceForUser(1, 'yuki', db);
    const second = await ensureWorkspaceForUser(2, 'taro', db);
    expect(second.id).not.toBe(first.id);
  });
});

describe('two accounts that want the same slug', () => {
  it('suffixes the second rather than failing or sharing', async () => {
    // The slug is globally unique in the schema, so without this the second
    // registration either throws or has to reuse the first one's workspace —
    // which is the one thing tenancy must never do.
    const { db, rows } = fakeDb();
    await ensureWorkspaceForUser(1, 'yuki', db);
    const second = await ensureWorkspaceForUser(2, 'yuki', db);
    expect(second.slug).toBe('yuki-2');
    expect(rows.map((r) => r.slug)).toEqual(['yuki', 'yuki-2']);
  });

  it('keeps counting past the second', async () => {
    const { db } = fakeDb();
    for (const userId of [1, 2, 3, 4]) await ensureWorkspaceForUser(userId, 'yuki', db);
    const fifth = await ensureWorkspaceForUser(5, 'yuki', db);
    expect(fifth.slug).toBe('yuki-5');
  });

  it('keeps the display name the user asked for, only the slug differs', async () => {
    const { db } = fakeDb();
    await ensureWorkspaceForUser(1, 'yuki', db);
    const second = await ensureWorkspaceForUser(2, 'yuki', db);
    expect(second.name).toBe('yuki');
  });
});

describe('a replayed registration', () => {
  it('returns the workspace the user already owns instead of a second one', async () => {
    // Not cosmetic: a second workspace for the same account would leave half
    // their data invisible from the other one, with no sign anything is wrong.
    const { db, rows } = fakeDb();
    const first = await ensureWorkspaceForUser(1, 'yuki', db);
    const again = await ensureWorkspaceForUser(1, 'yuki', db);
    expect(again).toEqual(first);
    expect(rows).toHaveLength(1);
  });

  it('ignores a changed display name once the user has one', async () => {
    const { db } = fakeDb();
    const first = await ensureWorkspaceForUser(1, 'yuki', db);
    const again = await ensureWorkspaceForUser(1, 'renamed', db);
    expect(again.id).toBe(first.id);
    expect(again.name).toBe('yuki');
  });
});

describe('names that do not make a slug on their own', () => {
  it.each([
    ['ゆき', 'workspace'],
    ['!!!', 'workspace'],
    ['Yuki Takamura', 'yuki-takamura'],
    ['--trim--', 'trim'],
  ])('%p becomes %p', async (name, expected) => {
    const { db } = fakeDb();
    const ws = await ensureWorkspaceForUser(1, name, db);
    expect(ws.slug).toBe(expected);
  });

  it('truncates a very long name to a slug the schema accepts', async () => {
    const { db } = fakeDb();
    const ws = await ensureWorkspaceForUser(1, 'a'.repeat(200), db);
    expect(ws.slug).toHaveLength(40);
  });

  it('still separates two accounts whose names both collapse to nothing', async () => {
    const { db } = fakeDb();
    const first = await ensureWorkspaceForUser(1, 'ゆき', db);
    const second = await ensureWorkspaceForUser(2, '！！！', db);
    expect(first.slug).toBe('workspace');
    expect(second.slug).toBe('workspace-2');
  });
});

describe('the default workspace', () => {
  it('is created once and found thereafter', async () => {
    const { db, rows } = fakeDb();
    const created = await ensureDefaultWorkspace(db);
    const again = await ensureDefaultWorkspace(db);
    expect(again).toEqual(created);
    expect(rows).toHaveLength(1);
    expect(rows[0].isDefault).toBe(true);
  });

  it('does not claim a user’s workspace as the default one', async () => {
    const { db, rows } = fakeDb();
    await ensureWorkspaceForUser(1, 'yuki', db);
    const def = await ensureDefaultWorkspace(db);
    expect(def.slug).toBe('default');
    expect(rows).toHaveLength(2);
  });
});
