/**
 * goal-reflection-router.test
 *
 * HTTP behaviour of the weekly reflection API: refusals are 4xx and store
 * nothing, a second save updates, and the trend is oldest first per goal.
 */
import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import type { ReflectionDb, ReflectionRow } from '../../services/goals/goal-reflection';
import type { SettingsDb } from '../../services/goals/reflection-prompt-settings';
import { createGoalReflectionRouter } from './goal-reflection-router';

function fakeDb(): ReflectionDb & SettingsDb & { rows: ReflectionRow[] } {
  const rows: ReflectionRow[] = [];
  let settings: Record<string, unknown> | null = null;
  return {
    rows,
    userSettings: {
      findFirst: async () => settings as never,
      create: async ({ data }) => (settings = { id: 1, ...data }) as never,
      update: async ({ data }) => (settings = { ...settings, ...data }) as never,
      updateMany: async () => ({ count: 0 }),
    },
    project: {
      findUnique: async ({ where }) => ([1, 2].includes(where.id) ? { id: where.id } : null),
    },
    goalReflection: {
      upsert: async ({ where, create, update }) => {
        const k = where.projectId_weekStart;
        const found = rows.find((r) => r.projectId === k.projectId && r.weekStart === k.weekStart);
        if (found) return Object.assign(found, update);
        const row = { ...create, updatedAt: new Date('2026-11-26T00:00:00Z') };
        rows.push(row);
        return row;
      },
      findMany: async ({ where }) =>
        rows
          .filter((r) => r.projectId === where.projectId)
          .sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    },
  };
}

function app(db: ReflectionDb & SettingsDb, now = new Date('2026-11-26T03:00:00Z')) {
  return new Elysia()
    .onError(({ error, set }) => {
      set.status = (error as { statusCode?: number }).statusCode ?? 500;
      return { error: (error as Error).message, code: (error as { code?: string }).code };
    })
    .use(createGoalReflectionRouter(db, () => now));
}

const put = (a: ReturnType<typeof app>, path: string, body: unknown) =>
  a.handle(
    new Request(`http://localhost${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('PUT /goals/:id/reflections', () => {
  test.each([0, 6, 1.5, '3', null])(
    'refuses rating %p with 400 and stores nothing',
    async (rating) => {
      const db = fakeDb();
      const res = await put(app(db), '/goals/1/reflections', { rating });
      expect(res.status).toBe(400);
      expect(db.rows).toHaveLength(0);
    },
  );

  test('refuses a 501-character note, accepts 500', async () => {
    const db = fakeDb();
    expect(
      (await put(app(db), '/goals/1/reflections', { rating: 3, note: 'a'.repeat(501) })).status,
    ).toBe(400);
    expect(db.rows).toHaveLength(0);
    expect(
      (await put(app(db), '/goals/1/reflections', { rating: 3, note: 'a'.repeat(500) })).status,
    ).toBe(200);
    expect(db.rows).toHaveLength(1);
  });

  test('refuses 500 characters plus trailing whitespace', async () => {
    const db = fakeDb();
    const res = await put(app(db), '/goals/1/reflections', {
      rating: 3,
      note: 'a'.repeat(500) + ' ',
    });
    expect(res.status).toBe(400);
    expect(db.rows).toHaveLength(0);
  });

  test('a second save in the same week keeps one row', async () => {
    const db = fakeDb();
    await put(app(db), '/goals/1/reflections', { rating: 2, note: 'a' });
    const res = await put(app(db), '/goals/1/reflections', { rating: 5, note: 'b' });
    expect(res.status).toBe(200);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ rating: 5, note: 'b' });
  });

  test('unknown goal is 404 and a malformed id is 400', async () => {
    const db = fakeDb();
    expect((await put(app(db), '/goals/9/reflections', { rating: 3 })).status).toBe(404);
    expect((await put(app(db), '/goals/abc/reflections', { rating: 3 })).status).toBe(400);
  });
});

describe('GET /goals/:id/reflections', () => {
  test('returns the goal weeks oldest first and nothing from other goals', async () => {
    const db = fakeDb();
    await put(app(db, new Date('2026-12-03T03:00:00Z')), '/goals/1/reflections', { rating: 5 });
    await put(app(db, new Date('2026-11-18T03:00:00Z')), '/goals/1/reflections', {
      rating: 2,
      note: 'x',
    });
    await put(app(db, new Date('2026-11-18T03:00:00Z')), '/goals/2/reflections', { rating: 4 });
    const res = await app(db).handle(new Request('http://localhost/goals/1/reflections'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projectId: number; weekStart: string; rating: number }[];
    expect(body.map((b) => [b.projectId, b.weekStart, b.rating])).toEqual([
      [1, '2026-11-16', 2],
      [1, '2026-11-30', 5],
    ]);
  });

  test('is an empty array with no records and 404 for an unknown goal', async () => {
    const db = fakeDb();
    const empty = await app(db).handle(new Request('http://localhost/goals/1/reflections'));
    expect(await empty.json()).toEqual([]);
    expect((await app(db).handle(new Request('http://localhost/goals/9/reflections'))).status).toBe(
      404,
    );
  });
});

describe('/goal-reflections/settings', () => {
  test('defaults to Sunday 20:00, saves a change, refuses an invalid one', async () => {
    const a = app(fakeDb());
    expect(
      await (await a.handle(new Request('http://localhost/goal-reflections/settings'))).json(),
    ).toEqual({ dow: 0, time: '20:00' });
    expect((await put(a, '/goal-reflections/settings', { dow: 6, time: '09:15' })).status).toBe(
      200,
    );
    expect(
      await (await a.handle(new Request('http://localhost/goal-reflections/settings'))).json(),
    ).toEqual({ dow: 6, time: '09:15' });
    expect((await put(a, '/goal-reflections/settings', { dow: 8, time: '09:15' })).status).toBe(
      400,
    );
    expect(
      await (await a.handle(new Request('http://localhost/goal-reflections/settings'))).json(),
    ).toEqual({ dow: 6, time: '09:15' });
  });
});
