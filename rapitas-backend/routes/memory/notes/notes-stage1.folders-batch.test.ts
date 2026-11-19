/**
 * notes-stage1.folders-batch.test
 *
 * Memo folders (design §2.3: one level, same name refused per workspace,
 * delete → 未分類) and `POST /notes/batch` (§8.3: placement decided by the
 * server, per-element atomic, create-if-absent, another workspace's task
 * rejected) end to end — real routes and services over the in-memory database.
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
const { noteFoldersRoutes } = await import('./note-folders.routes');
const { notesBatchRoutes } = await import('./notes-batch.routes');
const app = new Elysia().use(notesRoutes).use(noteFoldersRoutes).use(notesBatchRoutes);

type Body = Record<string, unknown>;
const note = (id: string) => db.find('note', { id }) as Body | undefined;

beforeEach(() => {
  db = seedStage1();
});

describe('memo folders', () => {
  it('creates, refuses a duplicate name in the same workspace, allows it in another', async () => {
    expect((await request(app, '/note-folders', json('POST', { name: '読書' }))).status).toBe(200);
    expect((await request(app, '/note-folders', json('POST', { name: ' 読書 ' }))).status).toBe(
      409,
    );
    expect((await request(app, '/note-folders', json('POST', { name: '読書' }), 2)).status).toBe(
      200,
    );
    expect(db.rows('noteFolder').filter((f) => f.name === '読書')).toHaveLength(2);
  });

  it('renames and reorders, refusing a name already taken', async () => {
    const created = (await request(app, '/note-folders', json('POST', { name: '読書' }))).body
      .folder as Body;
    expect(
      (await request(app, `/note-folders/${created.id}`, json('PATCH', { name: '雑記' }))).status,
    ).toBe(409);
    const { body } = await request(
      app,
      `/note-folders/${created.id}`,
      json('PATCH', { name: '本', sortOrder: 3 }),
    );
    expect(body.folder).toMatchObject({ name: '本', sortOrder: 3 });
  });

  it('deleting a folder moves its notes to 未分類 and keeps them', async () => {
    const { body } = await request(app, '/note-folders/5', { method: 'DELETE' });
    expect(body.movedToUnclassified).toBe(2);
    expect(note('n-folder')).toMatchObject({ folderId: null });
    expect(db.find('noteFolder', { id: 5 })).toBeUndefined();
  });

  it('answers 404 for another workspace’s folder', async () => {
    expect((await request(app, '/note-folders/6', json('PATCH', { name: 'x' }))).status).toBe(404);
    expect((await request(app, '/note-folders/6', { method: 'DELETE' })).status).toBe(404);
    expect(db.find('noteFolder', { id: 6 })).toBeDefined();
    expect(
      ((await request(app, '/note-folders', undefined, 2)).body.folders as Body[]).map((f) => f.id),
    ).toEqual([6]);
  });
});

describe('POST /notes/batch (§8.3)', () => {
  const batch = (notes: unknown[], ws?: number) =>
    request(app, '/notes/batch', json('POST', { notes }), ws);
  const learning = {
    id: 'learning-task-101',
    title: '単元1の学習ノート',
    content: '',
    source: 'learning',
    taskIds: [101],
  };

  it('creates a learning note placed by the server from the task’s effective theme', async () => {
    const { body } = await batch([learning]);
    expect(body.results).toEqual([{ id: 'learning-task-101', status: 'created', linksAdded: 1 }]);
    expect(note('learning-task-101')).toMatchObject({
      themeId: 10,
      source: 'learning',
      sourceTaskId: 101,
      followsTask: true,
    });
    const link = db.find('noteTaskLink', { noteId: 'learning-task-101', taskId: 101 }) as Body;
    expect(JSON.parse(link.meta as string)).toEqual({
      taskTitle: '単元1の問題',
      themeName: '英語',
      categoryName: '学習',
    });
  });

  it('skips an existing fixed id without touching what a person edited', async () => {
    await batch([learning]);
    await request(app, '/notes/learning-task-101', json('PATCH', { content: '自分で書いた' }));
    const { body } = await batch([{ ...learning, content: '再送', taskIds: [101] }]);
    expect((body.results as Body[])[0]?.status).toBe('skipped');
    expect(note('learning-task-101')?.content).toBe('自分で書いた');
  });

  it('rejects only the element whose task is in another workspace, writing nothing for it', async () => {
    const { body } = await batch([
      learning,
      { id: 'mat-1', title: '教材', content: '問題', source: 'material', taskIds: [100, 200] },
    ]);
    expect(body.results).toEqual([
      { id: 'learning-task-101', status: 'created', linksAdded: 1 },
      { id: 'mat-1', status: 'rejected', code: 404, error: 'task_not_found' },
    ]);
    expect(note('mat-1')).toBeUndefined();
    expect(db.rows('noteTaskLink').filter((l) => l.noteId === 'mat-1')).toEqual([]);
  });

  it('rolls the note back when a link write fails inside the element’s transaction', async () => {
    db.hooks.beforeCreate = (table, data) => {
      if (table === 'noteTaskLink' && data.taskId === 102) throw new Error('link write failed');
    };
    const { body } = await batch([
      {
        id: 'roadmap-11-1',
        title: '締め',
        content: '目標',
        source: 'roadmap',
        taskIds: [100, 102],
      },
    ]);
    expect((body.results as Body[])[0]).toMatchObject({ status: 'rejected' });
    expect(note('roadmap-11-1')).toBeUndefined();
    expect(db.rows('noteTaskLink').filter((l) => l.noteId === 'roadmap-11-1')).toEqual([]);
  });

  it('places the roadmap note on the theme its tasks share, without a source task', async () => {
    await batch([
      { id: 'roadmap-10-1', title: '締め', content: '', source: 'roadmap', taskIds: [100, 101] },
    ]);
    expect(note('roadmap-10-1')).toMatchObject({
      themeId: 10,
      sourceTaskId: null,
      followsTask: false,
    });
    await batch([
      { id: 'roadmap-x-2', title: '締め', content: '', source: 'roadmap', taskIds: [100, 102] },
    ]);
    expect(note('roadmap-x-2')).toMatchObject({ themeId: null, categoryId: null, folderId: null });
  });

  it.each([
    [{ ...learning, id: 'deliverable-task-101' }, 'reserved_note_id'],
    [{ ...learning, id: 'learning-task-999' }, 'invalid_fixed_id'],
    [{ ...learning, content: '<p>旧エディタ</p>' }, 'legacy_html_content'],
  ])('rejects %j', async (item, error) => {
    const { body } = await batch([item]);
    expect((body.results as Body[])[0]).toMatchObject({ status: 'rejected', error });
  });

  it('from workspace 2, a NULL-partition task is a 404 and its own task works', async () => {
    const { body } = await batch(
      [
        learning,
        { id: 'learning-task-200', title: 'x', content: '', source: 'learning', taskIds: [200] },
      ],
      2,
    );
    expect((body.results as Body[]).map((r) => r.status)).toEqual(['rejected', 'created']);
    expect(note('learning-task-200')).toMatchObject({ workspaceId: 2, themeId: 20 });
  });
});
