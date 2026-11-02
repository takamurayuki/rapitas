/**
 * tenancy.routes.test
 *
 * The HTTP shape of the endpoint that hands the pre-tenancy data an owner.
 *
 * Three properties matter. An unknown username must not silently create an
 * account or claim anything; a partial failure must not come back as a plain
 * success, since the database changed either way and the caller decides what
 * to do next; and GET must not act — it is what you ask in order to decide
 * whether to press POST.
 *
 * Nothing is mocked. The router takes its collaborators as arguments for the
 * reason deploy.routes.ts documents: `mock.module` on the Prisma client would
 * replace it for every other test file in the run.
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { createTenancyRoutes } from './tenancy.routes';
import type { BackfillResult } from '../../services/tenancy/workspace-backfill';

let claims: number[] = [];
let ensured: [number, string][] = [];
let cacheClears = 0;
let knownUser: { id: number; username: string } | null = { id: 7, username: 'alice' };
let claimResult: BackfillResult = {
  workspaceId: 1,
  totalClaimed: 3,
  models: [{ model: 'Category', claimed: 3 }],
  failed: [],
};

const app = new Elysia().use(
  createTenancyRoutes({
    listWorkspaces: async () => [
      {
        id: 1,
        slug: 'alice',
        name: 'Alice',
        isDefault: false,
        members: [{ userId: 7, role: 'owner' }],
      },
    ],
    countUnowned: async () => ({ totalUnowned: 3, models: [{ model: 'Category', claimed: 3 }] }),
    findUser: async (username) => (knownUser?.username === username ? knownUser : null),
    ensureWorkspace: async (userId, name) => {
      ensured.push([userId, name]);
      return { id: 1, slug: 'alice', name };
    },
    claim: async (workspaceId) => {
      claims.push(workspaceId);
      return claimResult;
    },
    onClaimed: () => {
      cacheClears += 1;
    },
  }),
);

const post = (body: unknown) =>
  app.handle(
    new Request('http://localhost/tenancy/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  claims = [];
  ensured = [];
  cacheClears = 0;
  knownUser = { id: 7, username: 'alice' };
  claimResult = {
    workspaceId: 1,
    totalClaimed: 3,
    models: [{ model: 'Category', claimed: 3 }],
    failed: [],
  };
});

describe('GET /tenancy/status', () => {
  test('reports the workspaces and what is still unowned without acting', async () => {
    const res = await app.handle(new Request('http://localhost/tenancy/status'));
    const body = (await res.json()) as {
      workspaces: { slug: string }[];
      unowned: { totalUnowned: number };
    };
    expect(res.status).toBe(200);
    expect(body.workspaces.map((w) => w.slug)).toEqual(['alice']);
    expect(body.unowned.totalUnowned).toBe(3);
    // The point of a separate GET: asking must not claim.
    expect(claims).toEqual([]);
  });
});

describe('POST /tenancy/claim', () => {
  test('claims the unowned rows for the named user’s workspace', async () => {
    const res = await post({ username: 'alice' });
    const body = (await res.json()) as { claimed: boolean; totalClaimed: number };
    expect(res.status).toBe(200);
    expect(body.claimed).toBe(true);
    expect(body.totalClaimed).toBe(3);
    expect(ensured).toEqual([[7, 'alice']]);
    expect(claims).toEqual([1]);
  });

  test('drops the resolved-workspace cache, so the user stops being unscoped', async () => {
    await post({ username: 'alice' });
    expect(cacheClears).toBe(1);
  });

  test('404s an unknown user instead of creating one', async () => {
    knownUser = null;
    const res = await post({ username: 'nobody' });
    expect(res.status).toBe(404);
    expect(ensured).toEqual([]);
    expect(claims).toEqual([]);
  });

  test('reports 207 when some models failed, not a flat success', async () => {
    claimResult = {
      workspaceId: 1,
      totalClaimed: 2,
      models: [{ model: 'Category', claimed: 2 }],
      failed: [{ model: 'Note', claimed: 0, error: 'boom' }],
    };
    const res = await post({ username: 'alice' });
    const body = (await res.json()) as { failed: { model: string }[] };
    // The database changed, so this is not a 500 — but a 200 would be read as
    // "all of it worked" by anything that only looks at the status.
    expect(res.status).toBe(207);
    expect(body.failed.map((f) => f.model)).toEqual(['Note']);
  });

  test('rejects a request with no username', async () => {
    const res = await post({});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(claims).toEqual([]);
  });
});
