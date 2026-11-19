/**
 * notes-stage1.write.test
 *
 * The write half of notes stage 1 end to end — real routes and services over
 * the in-memory database: a person's move through `placement` on PUT/PATCH
 * (contract 7), the server-only columns and reserved ids (contract 8),
 * 「タスクの分類に戻す」, the theme-delete preview, and every placement target
 * of another workspace answering 404 (§2.2). Folders and the batch are in
 * notes-stage1.folders-batch.test.ts.
 *
 * mock.module is process-global — run this file with --isolate.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { seedStage1, request, json } from '../../../tests/helpers/notes-stage1-seed';
import type { Stage1Db } from '../../../tests/helpers/notes-stage1-db';

let db: Stage1Db = seedStage1();
const prismaProxy = new Proxy({}, { get: (_t, key) => db.prisma[key as string] });
mock.module('../../../config/database', () => ({
  prisma: prismaProxy,
  ensureDatabaseConnection: async () => {},
}));

const { notesRoutes } = await import('../notes.routes');
const { notesStage1Routes } = await import('./notes-stage1.routes');
const app = new Elysia().use(notesRoutes).use(notesStage1Routes);

type Body = Record<string, unknown>;
const note = (id: string) => db.find('note', { id }) as Body | undefined;

beforeEach(() => {
  db = seedStage1();
});

describe('a person moves a note (contract 7)', () => {
  it('moves a manual note to a theme and reports the new placement', async () => {
    const { status, body } = await request(
      app,
      '/notes/n-none',
      json('PATCH', { placement: { kind: 'theme', id: 10 } }),
    );
    expect(status).toBe(200);
    expect((body.note as Body).placement).toMatchObject({ kind: 'theme', themeId: 10 });
    expect(note('n-none')).toMatchObject({ themeId: 10, categoryId: null, folderId: null });
  });

  it('keeps at most one placement column set', async () => {
    await request(app, '/notes/n-theme', json('PATCH', { placement: { kind: 'folder', id: 5 } }));
    expect(note('n-theme')).toMatchObject({ themeId: null, categoryId: null, folderId: 5 });
    await request(app, '/notes/n-theme', json('PATCH', { placement: { kind: 'none' } }));
    expect(note('n-theme')).toMatchObject({ themeId: null, categoryId: null, folderId: null });
  });

  it('places a new note where it was created', async () => {
    await request(
      app,
      '/notes/new-1',
      json('PUT', { title: 't', placement: { kind: 'category', id: 1 }, source: 'chat' }),
    );
    expect(note('new-1')).toMatchObject({ categoryId: 1, source: 'chat', followsTask: false });
  });

  it('stops a deliverable from following when a person moves it within the Q7 range', async () => {
    const { status } = await request(
      app,
      '/notes/deliverable-task-101',
      json('PATCH', { placement: { kind: 'category', id: 1 } }),
    );
    expect(status).toBe(200);
    expect(note('deliverable-task-101')).toMatchObject({
      categoryId: 1,
      themeId: null,
      followsTask: false,
    });
  });

  it.each([[{ kind: 'folder', id: 5 }], [{ kind: 'none' }]])(
    'refuses to move a deliverable to %j (Q7)',
    async (placement) => {
      const { status, body } = await request(
        app,
        '/notes/deliverable-task-101',
        json('PATCH', { placement }),
      );
      expect(status).toBe(400);
      expect(body.error).toBe('placement_out_of_range');
      expect(note('deliverable-task-101')).toMatchObject({ themeId: 10, followsTask: true });
    },
  );

  it.each([
    [{ kind: 'theme', id: 20 }],
    [{ kind: 'category', id: 2 }],
    [{ kind: 'folder', id: 6 }],
    [{ kind: 'theme', id: 999 }],
  ])(
    'answers 404 for a placement target of another workspace or none at all: %j',
    async (placement) => {
      const { status, body } = await request(app, '/notes/n-none', json('PATCH', { placement }));
      expect(status).toBe(404);
      expect(body.error).toBe('placement_target_not_found');
      expect(note('n-none')).toMatchObject({ themeId: null, categoryId: null, folderId: null });
    },
  );

  it('answers 404 from workspace 2 for a theme of the NULL partition', async () => {
    const { status } = await request(
      app,
      '/notes/other-ws',
      json('PATCH', { placement: { kind: 'theme', id: 10 } }),
      2,
    );
    expect(status).toBe(404);
  });
});

describe('server-only columns and reserved ids (contract 8)', () => {
  it.each(['deliverable-task-9', 'research-task-9', 'learning-task-9', 'roadmap-1-2'])(
    'refuses to create %s with PUT',
    async (id) => {
      const { status, body } = await request(app, `/notes/${id}`, json('PUT', { title: 'empty' }));
      expect(status).toBe(400);
      expect(body.error).toBe('reserved_note_id');
      expect(note(id)).toBeUndefined();
    },
  );

  it('still lets a person edit an existing deliverable’s body', async () => {
    const { status } = await request(
      app,
      '/notes/deliverable-task-101',
      json('PATCH', { content: '手を入れた' }),
    );
    expect(status).toBe(200);
    expect(note('deliverable-task-101')).toMatchObject({
      content: '手を入れた',
      source: 'deliverable',
      sourceTaskId: 101,
    });
  });

  it('refuses to turn a deliverable into a manual note through source', async () => {
    const { status } = await request(
      app,
      '/notes/deliverable-task-101',
      json('PATCH', { source: 'manual' }),
    );
    expect(status).toBe(400);
    expect(note('deliverable-task-101')?.source).toBe('deliverable');
  });

  it('ignores or refuses sourceTaskId / followsTask / sourceRef from a client', async () => {
    const res = await request(
      app,
      '/notes/n-none',
      json('PATCH', { title: 'x', sourceTaskId: 100, followsTask: true, sourceRef: '{"a":1}' }),
    );
    expect([200, 422]).toContain(res.status);
    expect(note('n-none')).toMatchObject({
      sourceTaskId: null,
      followsTask: false,
      sourceRef: null,
    });
  });

  it('keeps the import from taking a reserved id', async () => {
    const { body } = await request(
      app,
      '/notes/import',
      json('POST', { notes: [{ id: 'deliverable-task-5', title: 'x' }] }),
    );
    expect(body.conflictIds).toEqual(['deliverable-task-5']);
    expect(note('deliverable-task-5')).toBeUndefined();
  });
});

describe('POST /notes/:id/placement/reset (「タスクの分類に戻す」)', () => {
  it('puts a moved deliverable back on its task’s effective theme and follows again', async () => {
    await request(
      app,
      '/notes/deliverable-task-101',
      json('PATCH', { placement: { kind: 'category', id: 1 } }),
    );
    const { status } = await request(app, '/notes/deliverable-task-101/placement/reset', {
      method: 'POST',
    });
    expect(status).toBe(200);
    expect(note('deliverable-task-101')).toMatchObject({
      themeId: 10,
      categoryId: null,
      followsTask: true,
    });
  });

  it('goes to 未分類 (and keeps following) when the task has no effective theme', async () => {
    (db.find('task', { id: 100 }) as Body).themeId = null;
    await request(app, '/notes/deliverable-task-101/placement/reset', { method: 'POST' });
    expect(note('deliverable-task-101')).toMatchObject({
      themeId: null,
      categoryId: null,
      followsTask: true,
    });
  });

  it('answers 409 and changes nothing when the source task was deleted', async () => {
    await db.prisma.task.deleteMany({ where: { id: 101 } });
    const { status } = await request(app, '/notes/deliverable-task-101/placement/reset', {
      method: 'POST',
    });
    expect(status).toBe(409);
    expect(note('deliverable-task-101')).toMatchObject({ themeId: 10, sourceTaskId: null });
  });

  it('answers 400 for a manual note', async () => {
    expect((await request(app, '/notes/n-theme/placement/reset', { method: 'POST' })).status).toBe(
      400,
    );
  });
});

describe('theme delete preview (placementAfterThemeDelete)', () => {
  it('counts where the theme’s notes would go', async () => {
    const { body } = await request(app, '/notes/theme-delete-preview/10');
    // n-theme → category 1; the following deliverable of 101 has no other theme → category 1 too.
    expect(body).toMatchObject({ toCategory: 2, toUnclassified: 0, toThemes: [] });
  });

  it('is a 404 for another workspace’s theme', async () => {
    expect((await request(app, '/notes/theme-delete-preview/10', undefined, 2)).status).toBe(404);
  });
});
