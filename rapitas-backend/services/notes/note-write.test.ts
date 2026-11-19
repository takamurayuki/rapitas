/**
 * note-write.test
 *
 * The stage-0 save contract (design §5.3): whatever path writes a note's
 * title, content, tags or docType, the stored four fields and the stored
 * `version` agree — including when another write lands between this write's
 * read and its update. Run against an in-memory database whose conditional
 * updates really match nothing when the version moved.
 */
import { describe, expect, test } from 'bun:test';
import { createNoteMemoryDb, type MemoryNote } from '../../tests/helpers/note-memory-db';
import { saveNote, importNotes, NoteWriteConflictError, MAX_WRITE_ATTEMPTS } from './note-write';
import { backfillNoteVersions } from './note-version-backfill';
import { computeNoteVersion } from './note-version';
import { MAX_NOTE_TAGS } from './note-limits';
import { runInWorkspace } from '../tenancy/workspace-context';
import type { PrismaInstance } from './note-record';

const asClient = (p: unknown) => p as PrismaInstance;

/** The invariant itself: the stored version is the version of the stored fields. */
const consistent = (n: MemoryNote | undefined) => !!n && n.version === computeNoteVersion(n);

describe('saving a note keeps the stored fields and version in step', () => {
  test('a new note is written under the caller id with the version of what was stored', async () => {
    const db = createNoteMemoryDb();
    await saveNote(asClient(db.prisma), '1760000000000', { content: 'body only' });
    const stored = db.notes.get('1760000000000');
    expect(stored?.title).toBe('');
    expect(stored?.content).toBe('body only');
    expect(consistent(stored)).toBe(true);
  });

  test('a title-only update keeps the body and recomputes the version from the final value', async () => {
    const db = createNoteMemoryDb();
    const client = asClient(db.prisma);
    await saveNote(client, 'n1', { title: 'old', content: '本文', tags: ['a'] });
    const before = db.notes.get('n1')?.version;
    await saveNote(client, 'n1', { title: 'new' });
    const stored = db.notes.get('n1');
    expect(stored?.content).toBe('本文');
    expect(stored?.title).toBe('new');
    expect(stored?.version).not.toBe(before);
    expect(consistent(stored)).toBe(true);
  });

  test('a pin-only update leaves the version as it was', async () => {
    const db = createNoteMemoryDb();
    const client = asClient(db.prisma);
    await saveNote(client, 'n1', { title: 't', content: 'c' });
    const before = db.notes.get('n1')?.version;
    await saveNote(client, 'n1', { isPinned: true });
    expect(db.notes.get('n1')?.version).toBe(before);
    expect(db.notes.get('n1')?.isPinned).toBe(true);
  });

  test('a body written between the read and the update is kept, not paired with a stale version', async () => {
    const db = createNoteMemoryDb();
    const client = asClient(db.prisma);
    await saveNote(client, 'n1', { title: 'old', content: 'old body' });
    // The phone edits the body right after this title write read the row.
    let raced = false;
    db.hooks.beforeUpdateMany = async () => {
      if (raced) return;
      raced = true;
      const row = db.notes.get('n1');
      if (!row) return;
      row.content = 'phone body';
      row.version = computeNoteVersion(row);
    };
    await saveNote(client, 'n1', { title: 'pc title' });
    const stored = db.notes.get('n1');
    expect(stored?.title).toBe('pc title');
    expect(stored?.content).toBe('phone body');
    expect(consistent(stored)).toBe(true);
    // The first conditional update hit nothing; the retry wrote.
    expect(db.counts.noteUpdateMany).toBe(2);
  });

  test('gives up with a conflict, writing nothing, when the note never holds still', async () => {
    const db = createNoteMemoryDb();
    const client = asClient(db.prisma);
    await saveNote(client, 'n1', { title: 't', content: 'c' });
    let n = 0;
    db.hooks.beforeUpdateMany = async () => {
      const row = db.notes.get('n1');
      if (!row) return;
      row.content = `phone ${++n}`;
      row.version = computeNoteVersion(row);
    };
    await expect(saveNote(client, 'n1', { title: 'mine' })).rejects.toBeInstanceOf(
      NoteWriteConflictError,
    );
    expect(n).toBe(MAX_WRITE_ATTEMPTS);
    expect(db.notes.get('n1')?.title).toBe('t');
    expect(consistent(db.notes.get('n1'))).toBe(true);
  });

  test('a row the backfill has not reached is written under its updatedAt and gains a version', async () => {
    const db = createNoteMemoryDb();
    const client = asClient(db.prisma);
    await saveNote(client, 'old', { title: 'legacy', content: 'x' });
    const row = db.notes.get('old');
    if (row) row.version = null;
    await saveNote(client, 'old', { tags: ['t'] });
    expect(consistent(db.notes.get('old'))).toBe(true);
  });

  test('stores tags as JSON, trimmed and bounded', async () => {
    const db = createNoteMemoryDb();
    const tags = Array.from({ length: MAX_NOTE_TAGS + 5 }, (_, i) => ` tag${i} `);
    await saveNote(asClient(db.prisma), 'n1', { tags: [...tags, '   '] });
    const stored = JSON.parse(db.notes.get('n1')?.tags ?? '[]') as string[];
    expect(stored).toHaveLength(MAX_NOTE_TAGS);
    expect(stored[0]).toBe('tag0');
  });

  test('a request in another workspace cannot write over a NULL-partition note', async () => {
    const db = createNoteMemoryDb();
    const client = asClient(db.prisma);
    await saveNote(client, 'shared-id', { title: 'mine', content: 'c' });
    await expect(
      runInWorkspace(2, () => saveNote(client, 'shared-id', { title: 'theirs' })),
    ).rejects.toBeInstanceOf(NoteWriteConflictError);
    expect(db.notes.get('shared-id')?.title).toBe('mine');
  });
});

describe('taking in a browser full of notes', () => {
  test('creates unseen ids with a version and skips ids the server has', async () => {
    const db = createNoteMemoryDb();
    const client = asClient(db.prisma);
    await saveNote(client, 'n1', { title: 'server copy' });
    const result = await importNotes(client, [
      { id: 'n1', title: 'older browser copy' },
      { id: '1760000000002', title: 'b', content: '<div>html</div>' },
    ]);
    expect(result).toEqual({
      imported: 1,
      skipped: 1,
      importedIds: ['1760000000002'],
      skippedIds: ['n1'],
    });
    expect(db.notes.get('n1')?.title).toBe('server copy');
    expect(consistent(db.notes.get('1760000000002'))).toBe(true);
  });

  test('sending the same chunk twice changes nothing the second time', async () => {
    const db = createNoteMemoryDb();
    const client = asClient(db.prisma);
    const chunk = [
      { id: 'a', title: 'a' },
      { id: 'b', title: 'b' },
    ];
    await importNotes(client, chunk);
    const again = await importNotes(client, chunk);
    expect(again.imported).toBe(0);
    expect(db.notes.size).toBe(2);
  });
});

describe('backfilling versions on old rows', () => {
  const seedLegacy = (db: ReturnType<typeof createNoteMemoryDb>, id: string, at: string) => {
    db.notes.set(id, {
      id,
      workspaceId: null,
      title: id,
      content: 'old',
      isPinned: false,
      tags: '["x"]',
      color: null,
      docType: null,
      version: null,
      createdAt: new Date(at),
      updatedAt: new Date(at),
    });
  };

  test('fills every NULL version without touching updatedAt, and a rerun fills nothing', async () => {
    const db = createNoteMemoryDb();
    seedLegacy(db, 'a', '2026-01-01T00:00:00Z');
    seedLegacy(db, 'b', '2026-02-01T00:00:00Z');
    expect(await backfillNoteVersions(asClient(db.prisma))).toBe(2);
    expect(consistent(db.notes.get('a'))).toBe(true);
    expect(db.notes.get('a')?.updatedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(await backfillNoteVersions(asClient(db.prisma))).toBe(0);
  });

  test('does not overwrite a version a normal edit wrote after the backfill read the row', async () => {
    const db = createNoteMemoryDb();
    const client = asClient(db.prisma);
    seedLegacy(db, 'a', '2026-01-01T00:00:00Z');
    let raced = false;
    db.hooks.beforeUpdateMany = async (where) => {
      if (raced || where.version !== null || !('updatedAt' in where)) return;
      raced = true;
      db.hooks.beforeUpdateMany = undefined;
      await saveNote(client, 'a', { content: 'edited meanwhile' });
    };
    await backfillNoteVersions(client);
    const stored = db.notes.get('a');
    expect(stored?.content).toBe('edited meanwhile');
    expect(consistent(stored)).toBe(true);
  });
});
