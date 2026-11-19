/**
 * notes-stage1.read.test
 *
 * The read half of notes stage 1 end to end — the real routes and services
 * over the in-memory database (only `config/database` is replaced):
 * `GET /notes/tree`, `GET /notes` with filters / search / paging / summary,
 * `GET /notes/:id`. What is held here is design §2.2 contract 3: the tree,
 * the list and the detail all derive placement from describePlacement and
 * agree, and reading never writes. Plus the workspace rule for reads.
 *
 * mock.module is process-global — run this file with --isolate.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { seedStage1, request } from '../../../tests/helpers/notes-stage1-seed';
import type { Stage1Db } from '../../../tests/helpers/notes-stage1-db';

let db: Stage1Db = seedStage1();
const prismaProxy = new Proxy({}, { get: (_t, key) => db.prisma[key as string] });
mock.module('../../../config/database', () => ({
  prisma: prismaProxy,
  ensureDatabaseConnection: async () => {},
}));

const { notesRoutes } = await import('../notes.routes');
const { notesStage1Routes } = await import('./notes-stage1.routes');
// Same order as the generated memory barrel, so `/notes/tree` vs `/notes/:id` is as in production.
const app = new Elysia().use(notesRoutes).use(notesStage1Routes);

type Body = Record<string, unknown>;
type Tree = {
  categories: { id: number; noteCount: number; themes: TreeTheme[] }[];
  uncategorized: { themes: TreeTheme[] };
  folders: { id: number; noteCount: number }[];
  unclassified: { noteCount: number };
  total: number;
};
type TreeTheme = {
  id: number;
  noteCount: number;
  directNoteCount: number;
  sections: {
    taskId: number;
    noteIds: string[];
    elsewhere: { count: number; noteIds: string[] };
  }[];
};

const tree = async (ws?: number) =>
  (await request(app, '/notes/tree', undefined, ws)).body.tree as Tree;
const ids = (body: Body) => ((body.notes as Body[]) ?? []).map((n) => n.id as string).sort();

beforeEach(() => {
  db = seedStage1();
});

describe('GET /notes/tree', () => {
  it('counts every note once, where its columns place it', async () => {
    const t = await tree();
    const english = t.categories[0]?.themes.find((x) => x.id === 10);
    expect(t.categories.map((c) => c.id)).toEqual([1]);
    expect(t.categories[0]?.noteCount).toBe(1); // n-cat
    expect(english?.noteCount).toBe(2); // n-theme, deliverable-task-101
    expect(t.uncategorized.themes.map((x) => x.id)).toEqual([11]);
    expect(t.folders).toEqual([{ id: 5, name: '雑記', sortOrder: 0, noteCount: 2 }] as never);
    // n-none, and n-dangling whose theme is not a row of this workspace.
    expect(t.unclassified.noteCount).toBe(2);
    expect(t.total).toBe(7);
  });

  it('puts a subtask deliverable in the section of the subtask, under its effective theme', async () => {
    const english = (await tree()).categories[0]?.themes.find((x) => x.id === 10) as TreeTheme;
    expect(english.sections.map((s) => [s.taskId, s.noteIds])).toEqual([
      [100, ['n-theme']],
      [101, ['deliverable-task-101']],
    ]);
    expect(english.directNoteCount).toBe(0);
  });

  it('shows a note placed elsewhere in the task section without counting it', async () => {
    const roadmap = (await tree()).uncategorized.themes[0] as TreeTheme;
    expect(roadmap.noteCount).toBe(0);
    expect(roadmap.sections).toEqual([
      expect.objectContaining({
        taskId: 102,
        noteIds: [],
        elsewhere: { count: 1, noteIds: ['n-elsewhere'] },
      }),
    ]);
  });

  it('serves /notes/tree, not /notes/:id with id "tree"', async () => {
    const { status, body } = await request(app, '/notes/tree');
    expect(status).toBe(200);
    expect(body).toHaveProperty('tree');
  });
});

describe('the tree, the list and the detail agree (contract 3)', () => {
  it.each([
    ['themeId=10', (t: Tree) => t.categories[0]?.themes[0]?.noteCount],
    ['categoryId=1', (t: Tree) => t.categories[0]?.noteCount],
    ['folderId=5', (t: Tree) => t.folders[0]?.noteCount],
    ['themeId=none', (t: Tree) => t.unclassified.noteCount],
  ])('GET /notes?%s holds as many notes as the tree counts there', async (query, count) => {
    const t = await tree();
    const { status, body } = await request(app, `/notes?${query}`);
    expect(status).toBe(200);
    expect((body.notes as unknown[]).length).toBe(count(t) as number);
  });

  it('the detail and every list element report the same placement', async () => {
    const all = (await request(app, '/notes?limit=200')).body.notes as Body[];
    for (const listed of all) {
      const { body } = await request(app, `/notes/${listed.id}`);
      expect((body.note as Body).placement).toEqual(listed.placement);
    }
    const dangling = all.find((n) => n.id === 'n-dangling');
    expect(dangling?.placement).toEqual({ kind: 'none' });
    const english = all.find((n) => n.id === 'n-theme');
    expect(english?.placement).toEqual({
      kind: 'theme',
      themeId: 10,
      themeName: '英語',
      categoryId: 1,
      categoryName: '学習',
    });
  });

  it('the detail carries sourceTaskId and source', async () => {
    const { body } = await request(app, '/notes/deliverable-task-101');
    expect(body.note).toMatchObject({
      sourceTaskId: 101,
      source: 'deliverable',
      followsTask: true,
    });
  });

  it('reading writes nothing', async () => {
    const before = JSON.stringify(['note', 'noteTaskLink', 'task'].map((t) => db.rows(t as never)));
    await tree();
    await request(app, '/notes');
    await request(app, '/notes?themeId=none&fields=summary');
    await request(app, '/notes/deliverable-task-101');
    expect(JSON.stringify(['note', 'noteTaskLink', 'task'].map((t) => db.rows(t as never)))).toBe(
      before,
    );
    expect(db.calls.filter((c) => /\.(create|update|updateMany|deleteMany)$/.test(c))).toEqual([]);
  });
});

describe('GET /notes search, source, summary and paging', () => {
  it('searches title and content by partial match', async () => {
    expect(ids((await request(app, '/notes?q=' + encodeURIComponent('過去問'))).body)).toEqual([
      'n-theme',
    ]);
    expect(ids((await request(app, '/notes?q=' + encodeURIComponent('フォルダ'))).body)).toEqual([
      'n-folder',
    ]);
  });

  it('filters by source, with artifacts meaning every deliverable-type source', async () => {
    expect(ids((await request(app, '/notes?source=artifacts')).body)).toEqual([
      'deliverable-task-101',
    ]);
    expect(ids((await request(app, '/notes?source=manual')).body)).toHaveLength(6);
  });

  it('returns an excerpt instead of the body for fields=summary', async () => {
    const [first] = (await request(app, '/notes?themeId=10&fields=summary')).body.notes as Body[];
    expect(first).not.toHaveProperty('content');
    expect(typeof first?.excerpt).toBe('string');
  });

  it('pages with a cursor without repeating or skipping a note', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i += 1) {
      const path = `/notes?limit=3${cursor ? `&cursor=${cursor}` : ''}`;
      const { body } = await request(app, path);
      seen.push(...(body.notes as Body[]).map((n) => n.id as string));
      cursor = body.nextCursor as string | null;
      if (!cursor) break;
    }
    expect(seen.sort()).toEqual(ids((await request(app, '/notes?limit=200')).body));
    expect(new Set(seen).size).toBe(7);
  });

  it('refuses two placement filters at once and a broken cursor', async () => {
    expect((await request(app, '/notes?themeId=10&folderId=5')).status).toBe(400);
    expect((await request(app, '/notes?cursor=nonsense')).status).toBe(400);
  });

  it('keeps the plain list (all notes with bodies) unchanged, now with placement', async () => {
    const { body } = await request(app, '/notes');
    const notes = body.notes as Body[];
    expect(notes.every((n) => typeof n.content === 'string' && 'placement' in n)).toBe(true);
  });
});

describe('workspace isolation of the reads (§2.2)', () => {
  it('the tree of workspace 2 holds only its own rows', async () => {
    const t = await tree(2);
    expect(t.categories.map((c) => c.id)).toEqual([2]);
    expect(t.folders.map((f) => f.id)).toEqual([6]);
    expect(t.total).toBe(1);
  });

  it.each([
    ['/notes?themeId=10', 2],
    ['/notes?folderId=5', 2],
    ['/notes?categoryId=2', undefined],
    ['/notes?themeId=20', undefined],
  ])('%s from another workspace is a 404', async (path, ws) => {
    expect((await request(app, path, undefined, ws)).status).toBe(404);
  });

  it('reading another workspace’s note by id is a 404', async () => {
    expect((await request(app, '/notes/other-ws')).status).toBe(404);
    expect((await request(app, '/notes/n-theme', undefined, 2)).status).toBe(404);
    expect((await request(app, '/notes/other-ws', undefined, 2)).status).toBe(200);
  });

  it('the NULL partition never lists another workspace’s note', async () => {
    expect(ids((await request(app, '/notes?q=' + encodeURIComponent('秘密'))).body)).toEqual([]);
    expect(
      ids((await request(app, '/notes?q=' + encodeURIComponent('秘密'), undefined, 2)).body),
    ).toEqual(['other-ws']);
  });
});
