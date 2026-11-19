/**
 * note-service.test
 *
 * Notes, now that they are rows rather than a browser's localStorage.
 *
 * Reads, deletes and links. The write and the import moved to note-write
 * with the version contract, and are tested in note-write.test.ts against an
 * in-memory database.
 *
 * The service takes its client as an argument, so these tests hand it a
 * stand-in rather than replacing a module.
 */
import { describe, expect, test, beforeEach } from 'bun:test';
import { listNotes, getNote, deleteNote, linkNote, unlinkNote } from './note-service';

/** Every call the stand-in was asked to make. */
let calls: { op: string; args: Record<string, unknown> }[] = [];
let rows: Record<string, unknown>[] = [];
let existing: Record<string, unknown> | null = null;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  title: 'メモ',
  content: '本文',
  isPinned: false,
  tags: '["a","b"]',
  color: null,
  docType: null,
  createdAt: new Date('2026-10-01'),
  updatedAt: new Date('2026-10-02'),
  taskLinks: [{ taskId: 7, meta: '{"themeName":"rapitas"}' }],
  ...over,
});

const prisma = {
  note: {
    findMany: async (args: Record<string, unknown>) => {
      calls.push({ op: 'findMany', args });
      return rows;
    },
    findUnique: async (args: Record<string, unknown>) => {
      calls.push({ op: 'findUnique', args });
      return existing;
    },
    upsert: async (args: Record<string, unknown>) => {
      calls.push({ op: 'upsert', args });
      return row();
    },
    create: async (args: Record<string, unknown>) => {
      calls.push({ op: 'create', args });
      return row();
    },
    deleteMany: async (args: Record<string, unknown>) => {
      calls.push({ op: 'deleteMany', args });
      return { count: existing ? 1 : 0 };
    },
  },
  noteTaskLink: {
    upsert: async (args: Record<string, unknown>) => {
      calls.push({ op: 'link.upsert', args });
      return {};
    },
    deleteMany: async (args: Record<string, unknown>) => {
      calls.push({ op: 'link.deleteMany', args });
      return { count: 1 };
    },
  },
  // NOTE: the stand-in implements only the handful of delegates this service
  // touches, so it is cast rather than made to satisfy PrismaClient. Test
  // files are exempt from the no-explicit-any rule, so no directive here.
} as any;

const of = (op: string) => calls.filter((c) => c.op === op);

beforeEach(() => {
  calls = [];
  rows = [row()];
  existing = null;
});

describe('reading a note', () => {
  test('speaks the shape the client already has', async () => {
    const [note] = await listNotes(prisma);
    expect(note?.tags).toEqual(['a', 'b']);
    expect(note?.linkedTaskIds).toEqual([7]);
    expect(note?.linkedTaskMeta[7]).toEqual({ themeName: 'rapitas' });
  });

  test('survives a tags column that is not JSON', async () => {
    // One bad row must not take out the list; the note is still readable.
    rows = [row({ tags: 'not json at all' })];
    const [note] = await listNotes(prisma);
    expect(note?.tags).toEqual([]);
    expect(note?.title).toBe('メモ');
  });

  test('puts pinned notes first and recent ones next', async () => {
    await listNotes(prisma);
    expect(of('findMany')[0]?.args.orderBy).toEqual([{ isPinned: 'desc' }, { updatedAt: 'desc' }]);
  });

  test('narrows to one task when asked', async () => {
    await listNotes(prisma, 42);
    expect(of('findMany')[0]?.args.where).toEqual({ taskLinks: { some: { taskId: 42 } } });
  });

  test('says null rather than inventing a note that is not there', async () => {
    existing = null;
    expect(await getNote(prisma, 'missing')).toBeNull();
  });
});

describe('deleting a note', () => {
  test('reports whether there was anything to delete', async () => {
    expect(await deleteNote(prisma, 'gone')).toBe(false);
    existing = row();
    expect(await deleteNote(prisma, 'n1')).toBe(true);
  });
});

describe('attaching a note to a task', () => {
  test('is idempotent, so linking twice is not an error', async () => {
    await linkNote(prisma, 'n1', 7, { themeName: 'rapitas' });
    expect(of('link.upsert')[0]?.args.where).toEqual({
      noteId_taskId: { noteId: 'n1', taskId: 7 },
    });
  });

  test('stores no metadata rather than an empty object when none was given', async () => {
    await linkNote(prisma, 'n1', 7);
    const args = of('link.upsert')[0]?.args as { create: { meta: string | null } };
    expect(args.create.meta).toBeNull();
  });

  test('detaches without needing to know the link id', async () => {
    expect(await unlinkNote(prisma, 'n1', 7)).toBe(true);
    expect(of('link.deleteMany')[0]?.args.where).toEqual({ noteId: 'n1', taskId: 7 });
  });
});
