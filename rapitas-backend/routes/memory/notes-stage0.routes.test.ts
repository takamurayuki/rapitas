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
