/**
 * notes-stage1.scope.test
 *
 * Workspace checks of the stage-1 entry points that compare a related row
 * with the request's workspace (design §2.2「ワークスペース」), end to end over
 * the in-memory database:
 *
 * - The theme delete and its preview decide the target the same way: a theme
 *   outside the request's workspace (the NULL partition included) is a 404
 *   and nothing is moved or deleted.
 * - `GET /notes?taskId=…`, alone or with other filters, only lists notes of
 *   the request's workspace and answers 404 for a task outside it.
 * - 「タスクの分類に戻す」 answers 404 for a source task in another workspace
 *   and 409 only when the source task is gone.
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
const { themesRoutes } = await import('../../organization/themes');
const { AppError } = await import('../../../middleware/error-handler');
const app = new Elysia()
  .onError(({ error, set }) => {
    if (error instanceof AppError) {
      set.status = error.statusCode;
      return { error: error.message };
    }
    set.status = 500;
    return { error: error instanceof Error ? error.message : 'error' };
  })
  .use(notesRoutes)
  .use(notesStage1Routes)
  .use(themesRoutes);

type Body = Record<string, unknown>;
const note = (id: string) => db.find('note', { id }) as Body;
const ids = (body: Body) => (body.notes as Body[]).map((n) => n.id).sort();

beforeEach(() => {
  db = seedStage1();
});

describe('theme delete: the target is checked against the request (Must-fix 1)', () => {
  it('refuses, from the NULL partition, a theme of workspace 2 — preview and delete alike', async () => {
    const preview = await request(app, '/notes/theme-delete-preview/20');
    const del = await request(app, '/themes/20', { method: 'DELETE' });
    expect(preview.status).toBe(404);
    expect(del.status).toBe(404);
    expect(db.find('theme', { id: 20 })).toBeDefined();
    expect(note('other-ws')).toMatchObject({ themeId: 20, categoryId: null });
  });

  it('refuses, from workspace 2, a theme of the NULL partition — preview and delete alike', async () => {
    const preview = await request(app, '/notes/theme-delete-preview/10', undefined, 2);
    const del = await request(app, '/themes/10', { method: 'DELETE' }, 2);
    expect(preview.status).toBe(404);
    expect(del.status).toBe(404);
    expect(db.find('theme', { id: 10 })).toBeDefined();
    expect(note('n-theme')).toMatchObject({ themeId: 10, categoryId: null });
  });

  it('still deletes a theme of the request’s own workspace, moving its notes', async () => {
    const del = await request(app, '/themes/20', { method: 'DELETE' }, 2);
    expect(del.status).toBe(200);
    expect(db.find('theme', { id: 20 })).toBeUndefined();
    expect(note('other-ws')).toMatchObject({ themeId: null, categoryId: 2 });
  });
});

describe('GET /notes?taskId: the task is checked (Must-fix 2)', () => {
  it('alone, lists only the NULL partition’s notes of a NULL-partition task', async () => {
    // A note of workspace 2 linked to the NULL partition's task 100 must not leak.
    db.rows('note').push({ ...note('other-ws'), id: 'ws2-on-100' });
    db.rows('noteTaskLink').push({ id: 99, noteId: 'ws2-on-100', taskId: 100, workspaceId: 2 });
    const { status, body } = await request(app, '/notes?taskId=100');
    expect(status).toBe(200);
    expect(ids(body)).toEqual(['n-theme']);
  });

  it('alone, answers 404 for a task of another workspace', async () => {
    const { status } = await request(app, '/notes?taskId=200');
    expect(status).toBe(404);
    expect((await request(app, '/notes?taskId=100', undefined, 2)).status).toBe(404);
  });

  it('with other filters, answers 404 for a task of another workspace', async () => {
    const { status } = await request(app, '/notes?taskId=200&q=%E7%A7%98');
    expect(status).toBe(404);
  });

  it('with other filters, still lists the task’s notes in scope', async () => {
    const { status, body } = await request(app, '/notes?taskId=100&q=%E9%81%8E%E5%8E%BB');
    expect(status).toBe(200);
    expect(ids(body)).toEqual(['n-theme']);
  });
});

describe('placement reset: 404 for another workspace, 409 for a deleted task (Must-fix 2)', () => {
  it('answers 404 when the source task is in another workspace', async () => {
    note('deliverable-task-101').sourceTaskId = 200;
    const { status, body } = await request(app, '/notes/deliverable-task-101/placement/reset', {
      method: 'POST',
    });
    expect(status).toBe(404);
    expect(body.error).toBe('source_task_not_found');
    expect(note('deliverable-task-101')).toMatchObject({ themeId: 10, sourceTaskId: 200 });
  });

  it('answers 409 when the source task is gone', async () => {
    await request(
      app,
      '/notes/deliverable-task-101',
      json('PATCH', { placement: { kind: 'category', id: 1 } }),
    );
    note('deliverable-task-101').sourceTaskId = 4242; // no such task anywhere
    const { status, body } = await request(app, '/notes/deliverable-task-101/placement/reset', {
      method: 'POST',
    });
    expect(status).toBe(409);
    expect(body.error).toBe('source_task_deleted');
    expect(note('deliverable-task-101')).toMatchObject({ categoryId: 1, followsTask: false });
  });
});
