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
let queried: Record<string, unknown>[] = [];
let noteExists = true;
let unlinkFound = true;
let writeConflicts = false;

class NoteWriteConflictError extends Error {}
class NoteContentRejectedError extends Error {}
let rejectContent = false;

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
    if (rejectContent && typeof input.content === 'string') {
      throw new NoteContentRejectedError('legacy_html');
    }
    if (writeConflicts) throw new NoteWriteConflictError(id);
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
  NoteWriteConflictError,
  NoteContentRejectedError,
  MAX_NOTE_TITLE: 300,
  MAX_NOTE_CONTENT: 200000,
  MAX_NOTE_TAGS: 30,
  // Stage-1 exports (mirrored: Bun replaces the whole module).
  queryNotes: async (_p: unknown, query: Record<string, unknown>) => {
    queried.push(query);
    return { notes: [NOTE], nextCursor: null };
  },
  NoteQueryError: class NoteQueryError extends Error {},
  NotePlacementError: class NotePlacementError extends Error {},
}));

let taskInScope = true;

// Mirrors every export of note-links (Bun replaces the whole module).
mock.module('../../services/notes/note-links', () => ({
  linkNoteInScope: async (_p: unknown, id: string, taskId: number, meta?: unknown) => {
    if (!noteExists) return 'note_not_found';
    if (!taskInScope) return 'task_not_found';
    linked.push({ id, taskId, meta });
    return null;
  },
  importNoteLinks: async (_p: unknown, items: { noteId: string; taskId: number }[]) =>
    items.map((i) => ({ ...i, status: 'added' })),
  isTaskInScope: async () => taskInScope,
  isNoteInScope: async () => noteExists,
  cleanMeta: (m: unknown) => m ?? {},
  fillEmptyMeta: (e: Record<string, unknown>) => ({ merged: e, changed: false }),
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
  queried = [];
  noteExists = true;
  unlinkFound = true;
  writeConflicts = false;
  taskInScope = true;
  rejectContent = false;
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

  it('keeps the stage-0 list when no stage-1 parameter is sent', async () => {
    await call('/?taskId=42');
    expect(queried).toEqual([]);
  });

  it('parses the stage-1 parameters into one query', async () => {
    const { status, body } = await call(
      '/?themeId=3&q=%E8%AA%BF%E6%9F%BB&source=learning,artifacts&limit=20&fields=summary&taskId=9',
    );
    expect(status).toBe(200);
    expect(body).toHaveProperty('nextCursor', null);
    expect(queried).toEqual([
      {
        themeId: 3,
        taskId: 9,
        q: '調査',
        sources: ['learning', 'artifacts'],
        limit: 20,
        summary: true,
      },
    ]);
  });

  it('takes none as a placement filter', async () => {
    await call('/?folderId=none');
    expect(queried[0]).toEqual({ folderId: 'none' });
  });

  it.each([
    ['/?themeId=abc', 'invalid_themeId'],
    ['/?categoryId=-1', 'invalid_categoryId'],
    ['/?limit=0', 'invalid_limit'],
    ['/?fields=everything', 'invalid_fields'],
  ])('answers 400 for %s', async (path, error) => {
    const { status, body } = await call(path);
    expect(status).toBe(400);
    expect(body.error).toBe(error);
    expect(queried).toEqual([]);
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

  it('answers 400 when the service refuses the body as legacy HTML', async () => {
    rejectContent = true;
    const { status, body } = await call('/n1', json('PUT', { content: '<div>x</div>' }));
    expect(status).toBe(400);
    expect(body.error).toBe('legacy_html_content');
  });

  it('answers 409, not 500, when the note kept changing under the write', async () => {
    writeConflicts = true;
    const { status, body } = await call('/n1', json('PATCH', { title: 'x' }));
    expect(status).toBe(409);
    expect(body.error).toBe('note_write_conflict');
  });

  it('passes placement and a client source to the write', async () => {
    const { status } = await call(
      '/n1',
      json('PUT', { content: 'x', placement: { kind: 'folder', id: 4 }, source: 'chat' }),
    );
    expect(status).toBe(200);
    expect(saved[0]?.input).toEqual({
      content: 'x',
      placement: { kind: 'folder', id: 4 },
      source: 'chat',
    });
  });

  it('refuses a source only the server writes (contract 8)', async () => {
    const { status } = await call('/n1', json('PUT', { source: 'deliverable' }));
    expect(status).toBe(422);
    expect(saved).toEqual([]);
  });

  it('never hands server-only columns to the write', async () => {
    await call(
      '/n1',
      json('PATCH', { title: 't', sourceTaskId: 5, followsTask: true, sourceRef: '{}' }),
    );
    for (const key of ['sourceTaskId', 'followsTask', 'sourceRef']) {
      expect(saved[0]?.input ?? {}).not.toHaveProperty(key);
    }
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

  it('refuses, as 404, a task outside the request workspace', async () => {
    taskInScope = false;
    const { status, body } = await call('/n1/links', json('POST', { taskId: 70 }));
    expect(status).toBe(404);
    expect(body.error).toBe('task_not_found');
    expect(linked).toEqual([]);
  });

  it('takes the stage-0 meta keys the desktop tree needs', async () => {
    const meta = { taskTitle: '単元1', categoryName: '学習', themeName: '数学' };
    const { status } = await call('/n1/links', json('POST', { taskId: 7, meta }));
    expect(status).toBe(200);
    expect(linked[0]?.meta).toEqual(meta);
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
