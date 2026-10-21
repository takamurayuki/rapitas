/**
 * task-trash.test
 *
 * Deleting a task cascades across 43 relations, so the snapshot is the only
 * copy of anything. What has to hold: it is taken before the delete, it
 * carries the subtasks that the cascade is about to take, and restoring it
 * does not quietly produce a second copy of something already restored.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** Rows in the stand-in store, by table. */
let deletedTasks: Record<string, unknown>[] = [];
let createdTasks: Record<string, unknown>[] = [];
/** The exact `data` each task create was given — the stub adds an id, Prisma would too. */
let createPayloads: Record<string, unknown>[] = [];
/** The `select` the trash listing asked for. */
let listSelect: Record<string, unknown> | undefined;
/** Tasks the stand-in database contains. */
let tasks: Record<string, unknown>[] = [];

const TASK = {
  id: 10,
  title: 'アバターを直す',
  description: '元の発話',
  status: 'todo',
  priority: 'high',
  labels: '[]',
  estimatedHours: 2,
  actualHours: null,
  dueDate: null,
  themeId: 1,
  parentId: null,
  acceptanceCriteria: '["幅を超えない"]',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
};

const SUBTASK = { ...TASK, id: 11, title: '調査', parentId: 10, themeId: 1 };

const prismaStub = {
  task: {
    findUnique: async ({ where }: { where: { id: number } }) =>
      tasks.find((t) => t.id === where.id) ?? null,
    findMany: async ({ where }: { where: { parentId?: number } }) =>
      tasks.filter((t) => t.parentId === where.parentId),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      createPayloads.push(data);
      const row = { ...data, id: 100 + createdTasks.length };
      createdTasks.push(row);
      return row;
    },
  },
  deletedTask: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { ...data, id: deletedTasks.length + 1 };
      deletedTasks.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: number } }) =>
      deletedTasks.find((d) => d.id === where.id) ?? null,
    findMany: async (args: { select?: Record<string, unknown> }) => {
      listSelect = args?.select;
      return [...deletedTasks].reverse();
    },
    update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
      const row = deletedTasks.find((d) => d.id === where.id);
      Object.assign(row ?? {}, data);
      return row;
    },
    deleteMany: async ({ where }: { where: { deletedAt?: { lt: Date } } }) => {
      const before = deletedTasks.length;
      deletedTasks = deletedTasks.filter(
        (d) => !where.deletedAt || (d.deletedAt as Date) >= where.deletedAt.lt,
      );
      return { count: before - deletedTasks.length };
    },
  },
};

mock.module('../../config/database', () => ({
  prisma: prismaStub,
  ensureDatabaseConnection: async () => {},
}));

const { snapshotTaskForTrash, restoreFromTrash, listTrash, purgeTrash } =
  await import('./task-trash');

beforeEach(() => {
  deletedTasks = [];
  createdTasks = [];
  createPayloads = [];
  listSelect = undefined;
  tasks = [{ ...TASK }, { ...SUBTASK }];
});

describe('taking the snapshot', () => {
  test('keeps the task own columns', async () => {
    await snapshotTaskForTrash(10, 'user');
    const snap = JSON.parse(String(deletedTasks[0].snapshotJson));
    expect(snap.task).toMatchObject({ title: 'アバターを直す', priority: 'high', themeId: 1 });
  });

  // The cascade is about to take these, and nothing else will have them.
  test('keeps the subtasks the cascade is about to remove', async () => {
    await snapshotTaskForTrash(10, 'user');
    const snap = JSON.parse(String(deletedTasks[0].snapshotJson));
    expect(snap.subtasks).toHaveLength(1);
    expect(snap.subtasks[0].title).toBe('調査');
  });

  test('records who asked, so an assistant deletion is tellable apart', async () => {
    await snapshotTaskForTrash(10, 'assistant');
    expect(deletedTasks[0].source).toBe('assistant');
  });

  test('denormalises the title so the trash list needs no parsing', async () => {
    await snapshotTaskForTrash(10, 'user');
    expect(deletedTasks[0].title).toBe('アバターを直す');
    expect(deletedTasks[0].originalTaskId).toBe(10);
  });

  test('returns null for a task that is not there, without writing a row', async () => {
    expect(await snapshotTaskForTrash(999, 'user')).toBeNull();
    expect(deletedTasks).toEqual([]);
  });
});

describe('restoring', () => {
  test('brings the task back', async () => {
    await snapshotTaskForTrash(10, 'user');
    const restored = await restoreFromTrash(1);
    expect(restored?.title).toBe('アバターを直す');
    expect(createdTasks[0]).toMatchObject({ title: 'アバターを直す', themeId: 1 });
  });

  // A parent without its children is a crippled task, so the children come
  // back too — they were only deleted because the parent was.
  test('brings the subtasks back under the new parent', async () => {
    await snapshotTaskForTrash(10, 'user');
    await restoreFromTrash(1);
    expect(createdTasks).toHaveLength(2);
    expect(createdTasks[1]).toMatchObject({ title: '調査', parentId: createdTasks[0].id });
  });

  // Asserted on what was handed to create, not on the row that came back:
  // the database assigns the id either way.
  test('does not try to reuse the original id or its timestamps', async () => {
    await snapshotTaskForTrash(10, 'user');
    await restoreFromTrash(1);
    expect('id' in createPayloads[0]).toBe(false);
    expect('createdAt' in createPayloads[0]).toBe(false);
    expect('updatedAt' in createPayloads[0]).toBe(false);
  });

  // Otherwise a double-click produces two copies of the same task.
  test('refuses a second restore rather than making another copy', async () => {
    await snapshotTaskForTrash(10, 'user');
    await restoreFromTrash(1);
    expect(await restoreFromTrash(1)).toBeNull();
    expect(createdTasks).toHaveLength(2);
  });

  test('records what the restore produced, so the row is not a dead end', async () => {
    await snapshotTaskForTrash(10, 'user');
    await restoreFromTrash(1);
    expect(deletedTasks[0].restoredTaskId).toBe(createdTasks[0].id);
    expect(deletedTasks[0].restoredAt).toBeInstanceOf(Date);
  });

  // The column is required, and a task called nothing is worse than the one
  // that is missing.
  test('refuses a snapshot whose task has no title', async () => {
    tasks.push({ ...TASK, id: 30, title: '' });
    await snapshotTaskForTrash(30, 'user');
    expect(await restoreFromTrash(1)).toBeNull();
    expect(createdTasks).toEqual([]);
  });

  // The parent coming back is worth more than the one child that cannot.
  test('drops a nameless subtask rather than failing the whole restore', async () => {
    tasks.push({ ...TASK, id: 12, title: '', parentId: 10 });
    await snapshotTaskForTrash(10, 'user');
    await restoreFromTrash(1);
    expect(createdTasks).toHaveLength(2);
  });

  test('returns null for a row that is not there', async () => {
    expect(await restoreFromTrash(404)).toBeNull();
  });
});

describe('the trash list', () => {
  test('is newest first', async () => {
    tasks.push({ ...TASK, id: 20, title: '二件目' });
    await snapshotTaskForTrash(10, 'user');
    await snapshotTaskForTrash(20, 'user');
    const rows = await listTrash();
    expect(rows[0].title).toBe('二件目');
  });

  // Asserted on the select, since honouring it is the database's job.
  test('does not ask for the whole snapshot of every row', async () => {
    await snapshotTaskForTrash(10, 'user');
    await listTrash();
    expect(listSelect).toBeDefined();
    expect('snapshotJson' in (listSelect ?? {})).toBe(false);
    expect(listSelect?.title).toBe(true);
  });
});

describe('purging', () => {
  test('removes only what is older than the cutoff', async () => {
    await snapshotTaskForTrash(10, 'user');
    deletedTasks[0].deletedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    tasks.push({ ...TASK, id: 21, title: '最近消したもの' });
    await snapshotTaskForTrash(21, 'user');
    deletedTasks[1].deletedAt = new Date();

    const { count } = await purgeTrash(30);
    expect(count).toBe(1);
    expect(deletedTasks).toHaveLength(1);
    expect(deletedTasks[0].title).toBe('最近消したもの');
  });
});
