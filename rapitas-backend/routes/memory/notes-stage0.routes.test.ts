/**
 * notes-stage0.routes.test
 *
 * The stage-0 note API end to end through Elysia's `handle()`, with the real
 * services over an in-memory database (only `config/database` is replaced).
 * Where notes.routes.test.ts pins each route's contract against a stubbed
 * service, this file holds the behaviour the desktop migration and the two
 * devices depend on: what the manifest says, what resolve does on a resend,
 * which link writes reach another workspace's task, and that a note written
 * by one device is what the other reads.
 *
 * mock.module is process-global — run this file with --isolate.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { createNoteMemoryDb, type NoteMemoryDb } from '../../tests/helpers/note-memory-db';
import { runInWorkspace } from '../../services/tenancy/workspace-context';

let db: NoteMemoryDb = createNoteMemoryDb();

// A proxy, so each test's fresh database is the one the routes see: the
// module's `prisma` binding is read once, but every delegate lookup goes
// through to the current `db`.
const prismaProxy = new Proxy(
  {},
  { get: (_target, key) => (db.prisma as Record<string | symbol, unknown>)[key] },
);
mock.module('../../config/database', () => ({
  prisma: prismaProxy,
  ensureDatabaseConnection: async () => {},
}));

const { notesRoutes } = await import('./notes.routes');
const { notesMigrationRoutes } = await import('./notes-migration.routes');

type Body = Record<string, unknown>;

/** One request to whichever router owns the path, in an optional workspace. */
async function call(path: string, init?: RequestInit, workspaceId?: number) {
  const router = path.startsWith('/notes/migration') ? notesMigrationRoutes : notesRoutes;
  const run = async () => {
    const res = await router.handle(new Request(`http://localhost${path}`, init));
    return { status: res.status, body: (await res.json()) as Body };
  };
  return workspaceId === undefined ? run() : runInWorkspace(workspaceId, run);
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  db = createNoteMemoryDb({
    tasks: [
      { id: 7, workspaceId: null },
      { id: 8, workspaceId: null },
      { id: 70, workspaceId: 2 },
    ],
  });
});

describe('the migration endpoints', () => {
  it('serves a manifest with versions and without bodies', async () => {
    await call('/notes/chat-1', json('PUT', { title: '会話から', content: '本文' }));
    const { status, body } = await call('/notes/migration/manifest');
    expect(status).toBe(200);
    const [entry] = body.notes as Body[];
    expect(entry?.id).toBe('chat-1');
    expect(typeof entry?.version).toBe('string');
    expect(entry).not.toHaveProperty('content');
  });

  it('applies the PC version once and answers alreadyApplied to the resend', async () => {
    await call('/notes/chat-1', json('PUT', { title: '会話から', content: '本文' }));
    const manifest = await call('/notes/migration/manifest');
    const [entry] = manifest.body.notes as { version: string }[];
    const item = {
      id: 'chat-1',
      ifVersion: entry?.version,
      title: 'PC で編集',
      content: '本文（PC）',
      tags: [],
      docType: null,
    };
    const first = await call('/notes/migration/resolve', json('POST', { items: [item] }));
    expect((first.body.results as Body[])[0]?.status).toBe('applied');
    const again = await call('/notes/migration/resolve', json('POST', { items: [item] }));
    expect((again.body.results as Body[])[0]?.status).toBe('alreadyApplied');
    const read = await call('/notes/chat-1');
    expect((read.body.note as Body).title).toBe('PC で編集');
  });

  it('refuses a resolve item without an ifVersion', async () => {
    const { status } = await call(
      '/notes/migration/resolve',
      json('POST', { items: [{ id: 'x', title: '', content: '', tags: [], docType: null }] }),
    );
    expect(status).toBe(422);
  });

  it('imports more than one 500-note chunk without duplicates when a chunk is resent', async () => {
    const all = Array.from({ length: 1203 }, (_, i) => ({ id: `local-${i}`, title: `n${i}` }));
    const chunks = [all.slice(0, 500), all.slice(500, 1000), all.slice(1000)];
    // The second chunk's response is lost and the client sends it again.
    for (const chunk of [chunks[0], chunks[1], chunks[1], chunks[2]]) {
      const { status } = await call('/notes/import', json('POST', { notes: chunk }));
      expect(status).toBe(200);
    }
    expect(db.notes.size).toBe(1203);
    const tooMany = await call('/notes/import', json('POST', { notes: all.slice(0, 501) }));
    expect(tooMany.status).toBe(422);
  });
});

describe('links stay inside the workspace (completion condition 5)', () => {
  it('POST /notes/:id/links answers 404 for another workspace task and links nothing', async () => {
    await call('/notes/n1', json('PUT', { title: 'n1' }));
    const refused = await call('/notes/n1/links', json('POST', { taskId: 70 }));
    expect(refused.status).toBe(404);
    expect(refused.body.error).toBe('task_not_found');
    expect(db.links).toHaveLength(0);
  });

  it('POST /notes/links/import refuses that task per link, as 404, and adds the rest', async () => {
    await call('/notes/n1', json('PUT', { title: 'n1' }));
    const { status, body } = await call(
      '/notes/links/import',
      json('POST', {
        links: [
          { noteId: 'n1', taskId: 70 },
          { noteId: 'n1', taskId: 7, meta: { taskTitle: 'T', categoryName: 'C' } },
        ],
      }),
    );
    expect(status).toBe(200);
    expect(body.results).toEqual([
      { noteId: 'n1', taskId: 70, status: 'rejected', code: 404, error: 'task_not_found' },
      { noteId: 'n1', taskId: 7, status: 'added' },
    ]);
  });
});

describe('one set of notes for both devices (completion condition 6)', () => {
  it('a note and link the phone made are what the desktop list reads', async () => {
    // The phone's calls: PUT the note, then link it from a task.
    await call('/notes/phone-1', json('PUT', { title: 'スマホのメモ', content: '本文' }));
    await call('/notes/phone-1/links', json('POST', { taskId: 7, meta: { themeName: 'T' } }));
    // The desktop store's load: GET /notes.
    const { body } = await call('/notes');
    const note = (body.notes as Body[]).find((n) => n.id === 'phone-1');
    expect(note?.linkedTaskIds).toEqual([7]);
    expect((note?.linkedTaskMeta as Record<string, Body>)['7']).toEqual({ themeName: 'T' });
  });

  it('a note and link the desktop made are what the phone task section reads', async () => {
    // The desktop store's calls: PUT, then link with the shared meta shape.
    await call('/notes/1795000000000', json('PUT', { title: 'PC のメモ', content: '' }));
    await call(
      '/notes/1795000000000/links',
      json('POST', { taskId: 8, meta: { taskTitle: '単元', categoryName: '学習' } }),
    );
    // The phone's task "資料" section: GET /notes?taskId=8.
    const { body } = await call('/notes?taskId=8');
    expect((body.notes as Body[]).map((n) => n.id)).toEqual(['1795000000000']);
  });
});

describe('no normal path stores new HTML (completion condition 4)', () => {
  it('PUT and PATCH refuse a legacy HTML body with 400', async () => {
    const put = await call('/notes/n1', json('PUT', { content: '<div>本文</div>' }));
    expect(put.status).toBe(400);
    expect(put.body.error).toBe('legacy_html_content');
    await call('/notes/n1', json('PUT', { title: 't', content: 'md' }));
    const patch = await call('/notes/n1', json('PATCH', { content: '<p>x</p>' }));
    expect(patch.status).toBe(400);
    expect(db.notes.get('n1')?.content).toBe('md');
  });

  it('PUT accepts an empty body and a plain one-line body', async () => {
    expect((await call('/notes/e', json('PUT', { title: '', content: '' }))).status).toBe(200);
    expect((await call('/notes/l', json('PUT', { content: '牛乳を買う' }))).status).toBe(200);
  });

  it('the import still takes HTML, and a later body-less PATCH on that note is fine', async () => {
    const imported = await call(
      '/notes/import',
      json('POST', { notes: [{ id: 'h', title: 'h', content: '<div>原本</div>' }] }),
    );
    expect(imported.body).toMatchObject({ imported: 1 });
    const patch = await call('/notes/h', json('PATCH', { title: '改名', isPinned: true }));
    expect(patch.status).toBe(200);
    expect(db.notes.get('h')?.content).toBe('<div>原本</div>');
  });
});
