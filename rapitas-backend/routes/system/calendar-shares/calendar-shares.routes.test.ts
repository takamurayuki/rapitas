/**
 * calendar-shares.routes.test
 *
 * The HTTP skin over the share handlers (#1270).
 *
 * The handlers already decide who may read what and are tested for it; what
 * this file holds down is the translation, because that is where a refusal
 * turns into something a browser acts on. A `not_shared` that arrives as 200
 * with an empty list is indistinguishable from an empty month, and a 403 that
 * arrives as 500 reads to the frontend as "retry later" rather than "you are
 * not allowed".
 */
import { describe, test, expect } from 'bun:test';
import { createCalendarShareRoutes } from './calendar-shares.routes';
import type { CalendarShareDeps, SharedScheduleEvent } from './calendar-shares-handlers';
import type { CalendarShareRow } from '../../../services/tenancy/calendar-share/calendar-share-store';

const EVENT: SharedScheduleEvent = {
  id: 1,
  title: '週会',
  startAt: new Date('2026-01-05T09:00:00.000Z'),
  endAt: new Date('2026-01-05T10:00:00.000Z'),
  isAllDay: false,
  color: '#4f46e5',
  type: 'event',
};

/** The grants the fake table holds, as the store would return them. */
function grantRows(pairs: { owner: number; viewer: number }[]): CalendarShareRow[] {
  return pairs.map((pair, index) => ({
    id: index + 1,
    ownerWorkspaceId: pair.owner,
    viewerWorkspaceId: pair.viewer,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }));
}

/**
 * Deps with every collaborator stubbed.
 *
 * `runInWorkspace` records the workspace it was asked for and then just runs
 * the function: the real one is the scope layer's, and the handler tests
 * already hold that the read happens inside the OWNER's scope.
 */
function fakeDeps(overrides: Partial<CalendarShareDeps> = {}) {
  const ranIn: number[] = [];
  const deps: CalendarShareDeps = {
    shares: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => grantRows([{ owner: 1, viewer: 2 }])[0]!,
      deleteMany: async () => ({ count: 0 }),
    },
    resolvePerson: async () => null,
    describePeople: async () => new Map(),
    runInWorkspace: async (workspaceId, fn) => {
      ranIn.push(workspaceId);
      return fn();
    },
    listSchedules: async () => [EVENT],
    ...overrides,
  };
  return { deps, ranIn };
}

/** Build the router with a fixed caller workspace. */
function routes(workspaceId: number | null, overrides: Partial<CalendarShareDeps> = {}) {
  const { deps, ranIn } = fakeDeps(overrides);
  return {
    app: createCalendarShareRoutes({ deps, currentWorkspaceId: () => workspaceId }),
    ranIn,
  };
}

const get = (app: ReturnType<typeof createCalendarShareRoutes>, path: string) =>
  app.handle(new Request(`http://localhost/calendar-shares${path}`));

describe('reading a shared calendar', () => {
  test('answers 200 with the events when the grant exists', async () => {
    const { app } = routes(2, {
      shares: {
        findFirst: async () => grantRows([{ owner: 9, viewer: 2 }])[0]!,
        findMany: async () => [],
        create: async () => grantRows([{ owner: 9, viewer: 2 }])[0]!,
        deleteMany: async () => ({ count: 0 }),
      },
    });
    const res = await get(app, '/9/schedules?from=2026-01-01&to=2026-01-31');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: { title: string }[] };
    expect(body.events.map((event) => event.title)).toEqual(['週会']);
  });

  test('answers 403, not an empty month, when there is no grant', async () => {
    const { app } = routes(2);
    const res = await get(app, '/9/schedules?from=2026-01-01&to=2026-01-31');
    expect(res.status).toBe(403);
  });

  test('answers 401 when nobody is signed in', async () => {
    const { app } = routes(null);
    const res = await get(app, '/9/schedules?from=2026-01-01&to=2026-01-31');
    expect(res.status).toBe(401);
  });

  test('answers 400 for an owner that is not a workspace id', async () => {
    const { app } = routes(2);
    const res = await get(app, '/not-a-number/schedules');
    expect(res.status).toBe(400);
  });

  test('reads inside the owner-s workspace, not the caller-s', async () => {
    const { app, ranIn } = routes(2, {
      shares: {
        findFirst: async () => grantRows([{ owner: 9, viewer: 2 }])[0]!,
        findMany: async () => [],
        create: async () => grantRows([{ owner: 9, viewer: 2 }])[0]!,
        deleteMany: async () => ({ count: 0 }),
      },
    });
    await get(app, '/9/schedules?from=2026-01-01&to=2026-01-31');
    expect(ranIn).toEqual([9]);
  });

  test('defaults the window rather than refusing when none is given', async () => {
    // The month view always sends one; a bare URL is a person poking at the
    // API, and a 400 there teaches nothing.
    const { app } = routes(2, {
      shares: {
        findFirst: async () => grantRows([{ owner: 9, viewer: 2 }])[0]!,
        findMany: async () => [],
        create: async () => grantRows([{ owner: 9, viewer: 2 }])[0]!,
        deleteMany: async () => ({ count: 0 }),
      },
    });
    const res = await get(app, '/9/schedules');
    expect(res.status).toBe(200);
  });
});

describe('listing both directions', () => {
  test('answers 200 with who shows what', async () => {
    const { app } = routes(2, {
      shares: {
        findFirst: async () => null,
        findMany: async (args) => {
          const where = (args as { where: Record<string, number> }).where;
          return where.ownerWorkspaceId === 2
            ? grantRows([{ owner: 2, viewer: 5 }])
            : grantRows([{ owner: 9, viewer: 2 }]);
        },
        create: async () => grantRows([{ owner: 2, viewer: 5 }])[0]!,
        deleteMany: async () => ({ count: 0 }),
      },
      describePeople: async (ids) =>
        new Map(ids.map((id) => [id, { username: `user${id}`, email: null }])),
    });
    const res = await get(app, '/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sharedByMe: { username: string }[];
      sharedWithMe: { username: string }[];
    };
    expect(body.sharedByMe.map((p) => p.username)).toEqual(['user5']);
    expect(body.sharedWithMe.map((p) => p.username)).toEqual(['user9']);
  });

  test('answers 401 when nobody is signed in', async () => {
    const { app } = routes(null);
    const res = await get(app, '/');
    expect(res.status).toBe(401);
  });
});

describe('granting', () => {
  const post = (app: ReturnType<typeof createCalendarShareRoutes>, body: unknown) =>
    app.handle(
      new Request('http://localhost/calendar-shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  test('answers 200 and names the person it shared with', async () => {
    const { app } = routes(2, {
      resolvePerson: async () => ({
        workspaceId: 5,
        userId: 50,
        username: 'ゆうき',
        email: 'y@example.com',
      }),
    });
    const res = await post(app, { identifier: 'ゆうき' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { person: { username: string } };
    expect(body.person.username).toBe('ゆうき');
  });

  test('answers 404 for a person who is not here', async () => {
    const { app } = routes(2);
    const res = await post(app, { identifier: 'いない人' });
    expect(res.status).toBe(404);
  });

  test('answers 400 for sharing with yourself', async () => {
    const { app } = routes(2, {
      resolvePerson: async () => ({
        workspaceId: 2,
        userId: 20,
        username: 'じぶん',
        email: null,
      }),
    });
    const res = await post(app, { identifier: 'じぶん' });
    expect(res.status).toBe(400);
  });

  test('answers 401 when nobody is signed in', async () => {
    const { app } = routes(null);
    const res = await post(app, { identifier: 'だれか' });
    expect(res.status).toBe(401);
  });

  test('rejects an empty identifier before asking the database', async () => {
    let asked = false;
    const { app } = routes(2, {
      resolvePerson: async () => {
        asked = true;
        return null;
      },
    });
    const res = await post(app, { identifier: '' });
    expect(res.status).toBe(422);
    expect(asked).toBe(false);
  });
});

describe('revoking', () => {
  const del = (app: ReturnType<typeof createCalendarShareRoutes>, path: string) =>
    app.handle(new Request(`http://localhost/calendar-shares${path}`, { method: 'DELETE' }));

  test('answers 200 with how many grants went away', async () => {
    const { app } = routes(2, {
      shares: {
        findFirst: async () => null,
        findMany: async () => [],
        create: async () => grantRows([{ owner: 2, viewer: 5 }])[0]!,
        deleteMany: async () => ({ count: 1 }),
      },
    });
    const res = await del(app, '/5');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 1 });
  });

  test('answers 200 with zero when there was nothing to revoke', async () => {
    // Idempotent on purpose: the settings card may be a tab behind, and a
    // 404 there would make a revoke look broken when it had already run.
    const { app } = routes(2);
    const res = await del(app, '/5');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 0 });
  });

  test('answers 401 when nobody is signed in', async () => {
    const { app } = routes(null);
    const res = await del(app, '/5');
    expect(res.status).toBe(401);
  });

  test('answers 400 for a viewer that is not a workspace id', async () => {
    const { app } = routes(2);
    const res = await del(app, '/not-a-number');
    expect(res.status).toBe(400);
  });

  // NOTE(#1349): 'not-a-number' is the easy half. Number() accepts notations
  // that resolve to a DIFFERENT workspace — '5e2' is 500 and '0x10' is 16,
  // both integers and both positive — so the Number.isInteger guard reported
  // them valid and the revoke ran against that other workspace's grant. The
  // guard looked strict and was not. Asserting deleteMany is never reached,
  // because the status alone would pass on a 400 that still deleted.
  test.each([
    ['exponent notation', '/5e2'],
    ['hex notation', '/0x10'],
    ['a trailing suffix', '/5abc'],
    ['leading whitespace', '/%205'],
  ])('refuses %s (%s) rather than revoking another workspace', async (_label, path) => {
    let revokes = 0;
    const { app } = routes(2, {
      shares: {
        findFirst: async () => null,
        findMany: async () => [],
        create: async () => grantRows([{ owner: 2, viewer: 5 }])[0]!,
        deleteMany: async () => {
          revokes += 1;
          return { count: 1 };
        },
      },
    });

    const res = await del(app, path);

    expect(res.status).toBe(400);
    expect(revokes).toBe(0);
  });
});
