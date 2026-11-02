/**
 * notes.routes.test
 *
 * The endpoints that take notes out of one browser.
 *
 * Integration tests through Elysia's `handle()`. The service is stubbed via
 * mock.module (process-global — run this file in isolation), with every
 * export mirrored: Bun replaces the whole module, so a missing one makes the
 * file stop with a single error and its tests silently vanish.
 *
 * What is worth holding here is the contract the client will be written
 * against: the id travels in the URL and is never minted by the server, a
 * missing note is a 404 rather than a 500, and a note cannot be linked to a
 * task without existing first.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let saved: { id: string; input: Record<string, unknown> }[] = [];
let linked: { id: string; taskId: number; meta?: unknown }[] = [];
let listedTaskId: number | undefined;
let noteExists = true;
let unlinkFound = true;

const NOTE = {
  id: 'n1',
  title: 'メモ',
  content: '本文',
  isPinned: false,
  tags: [],
  createdAt: new Date('2026-10-01'),
  updatedAt: new Date('2026-10-02'),
  linkedTaskIds: [] as number[],
  linkedTaskMeta: {},
};

mock.module('../../services/notes/note-service', () => ({
  listNotes: async (_p: unknown, taskId?: number) => {
    listedTaskId = taskId;
    return [NOTE];
  },
  getNote: async () => (noteExists ? NOTE : null),
  saveNote: async (_p: unknown, id: string, input: Record<string, unknown>) => {
    saved.push({ id, input });
    return { ...NOTE, id, ...input };
  },
  deleteNote: async () => noteExists,
  linkNote: async (_p: unknown, id: string, taskId: number, meta?: unknown) => {
    linked.push({ id, taskId, meta });
  },
  unlinkNote: async () => unlinkFound,
  importNotes: async (_p: unknown, notes: unknown[]) => ({
    imported: notes.length,
    skipped: 0,
  }),
  MAX_NOTE_TITLE: 300,
  MAX_NOTE_CONTENT: 200000,
  MAX_NOTE_TAGS: 30,
}));

mock.module('../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: async () => {},
}));

const { notesRoutes } = await import('./notes.routes');

const BASE = 'http://localhost/notes';

const call = async (path: string, init?: RequestInit) => {
  const res = await notesRoutes.handle(new Request(BASE + path, init));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  saved = [];
  linked = [];
  listedTaskId = undefined;
  noteExists = true;
  unlinkFound = true;
});

describe('listing', () => {
  it('returns the notes', async () => {
    const { status, body } = await call('/');
    expect(status).toBe(200);
    expect((body.notes as unknown[]).length).toBe(1);
  });

  it('passes a task filter through as a number', async () => {
    await call('/?taskId=42');
    expect(listedTaskId).toBe(42);
  });

  it('ignores a task filter that is not a number, rather than filtering by NaN', async () => {
    await call('/?taskId=abc');
    expect(listedTaskId).toBeUndefined();
  });
});

describe('reading one', () => {
  it('404s for a note that is not there', async () => {
    noteExists = false;
    const { status, body } = await call('/nope');
    expect(status).toBe(404);
    expect(body.error).toBe('note_not_found');
  });
});

describe('writing', () => {
  it('writes under the id in the URL, never one of its own', async () => {
    // Task descriptions already carry /rapitas-note/{taskId}/{noteId} chips.
    // A server-minted id would break every one of them.
    await call('/1760000000000', json('PUT', { title: 'x' }));
    expect(saved[0]?.id).toBe('1760000000000');
  });

  it('treats PATCH the same way, with only the fields that were sent', async () => {
    await call('/n1', json('PATCH', { isPinned: true }));
    expect(saved[0]?.input).toEqual({ isPinned: true });
  });

  it('refuses a title longer than the column', async () => {
    const { status } = await call('/n1', json('PUT', { title: 'あ'.repeat(400) }));
    expect(status).toBe(422);
  });

  it('404s when deleting something that is not there', async () => {
    noteExists = false;
    const { status } = await call('/n1', { method: 'DELETE' });
    expect(status).toBe(404);
  });
});

describe('attaching to a task', () => {
  it('links, carrying the context it was given', async () => {
    const { status } = await call(
      '/n1/links',
      json('POST', { taskId: 7, meta: { themeName: 'rapitas' } }),
    );
    expect(status).toBe(200);
    expect(linked[0]).toEqual({ id: 'n1', taskId: 7, meta: { themeName: 'rapitas' } });
  });

  it('refuses to link a note that does not exist', async () => {
    // Left to the foreign key this would surface as a 500, which tells the
    // caller nothing about what they got wrong.
    noteExists = false;
    const { status, body } = await call('/n1/links', json('POST', { taskId: 7 }));
    expect(status).toBe(404);
    expect(body.error).toBe('note_not_found');
    expect(linked).toEqual([]);
  });

  it('404s when unlinking something that was not linked', async () => {
    unlinkFound = false;
    const { status, body } = await call('/n1/links/7', { method: 'DELETE' });
    expect(status).toBe(404);
    expect(body.error).toBe('link_not_found');
  });
});

describe('the one-time import', () => {
  it('reports what it took in', async () => {
    const { status, body } = await call(
      '/import',
      json('POST', {
        notes: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
        ],
      }),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ imported: 2, skipped: 0 });
  });

  it('refuses a payload without ids — the ids are the point', async () => {
    const { status } = await call('/import', json('POST', { notes: [{ title: 'no id' }] }));
    expect(status).toBe(422);
  });
});
