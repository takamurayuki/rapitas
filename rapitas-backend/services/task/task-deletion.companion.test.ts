/**
 * task-deletion: companion rows are closed and kept (companion design 4.3)
 *
 * G2 review item 3: with a cascading foreign key, deleting a task erased its
 * TaskCompanion row, so `closedReason='task_deleted'` could never be recorded.
 * The row now has no foreign key and the deletion closes it — for the task and
 * every subtask the delete cascades to — in the same transaction as the
 * delete. Rows live in an in-memory store with real rollback, so what is
 * checked is the rows left behind.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { createMemoryDb, type MemoryDb } from '../../tests/helpers/companion-memory-db';

let db: MemoryDb = createMemoryDb();

mock.module('../../config/database', () => ({
  // A proxy so each test's fresh store is the one the module sees (the
  // factory's result is read once, so a plain reference would go stale).
  prisma: new Proxy({}, { get: (_target, key: string) => db.client[key] }),
  ensureDatabaseConnection: async () => {},
}));
mock.module('./task-worktree-cleanup', () => ({ cleanUpTaskWorktrees: async () => {} }));
mock.module('./task-trash', () => ({ snapshotTaskForTrash: async () => 7 }));
mock.module('./task-measurement-snapshot', () => ({
  TASK_MEASUREMENT_EVENT: 'task_measurement_snapshot',
  snapshotTaskMeasurements: async () => null,
}));

const { deleteTaskWithTrash } = await import('./task-deletion');

/** A parent (1) with a child (2) and a grandchild (3); task 9 is unrelated. */
function seed() {
  db = createMemoryDb();
  db.tables.Task.push(
    { id: 1, title: 'parent', parentId: null, isProtected: false, workspaceId: 4 },
    { id: 2, title: 'child', parentId: 1, isProtected: false, workspaceId: 4 },
    { id: 3, title: 'grandchild', parentId: 2, isProtected: false, workspaceId: 4 },
    { id: 9, title: 'other', parentId: null, isProtected: false, workspaceId: 4 },
  );
  const row = (id: number, taskId: number, closed?: { at: Date; reason: string }) => ({
    id,
    taskId,
    origin: 'task_create',
    workspaceId: 4,
    closedAt: closed?.at ?? null,
    closedReason: closed?.reason ?? null,
  });
  db.tables.TaskCompanion.push(
    row(1, 1),
    row(2, 3),
    row(3, 9),
    row(4, 2, { at: new Date('2026-01-01'), reason: 'stopped_by_user' }),
  );
}

beforeEach(seed);

const rowFor = (taskId: number) => db.tables.TaskCompanion.find((r) => r.taskId === taskId);

describe('deleting a task closes its companion rows and keeps them', () => {
  test('the deleted task and its cascaded subtasks are closed as task_deleted', async () => {
    const result = await deleteTaskWithTrash(1, 'user');
    expect(result.outcome).toBe('deleted');
    // The tasks are gone (cascade to 2 and 3)…
    expect(db.tables.Task.map((t) => t.id)).toEqual([9]);
    // …and the rows are still there, closed.
    expect(rowFor(1)).toMatchObject({ closedReason: 'task_deleted' });
    expect(rowFor(1)?.closedAt).toBeInstanceOf(Date);
    expect(rowFor(3)).toMatchObject({ closedReason: 'task_deleted' });
    expect(db.tables.TaskCompanion).toHaveLength(4);
  });

  test('a row already closed keeps its own reason and time', async () => {
    await deleteTaskWithTrash(1, 'user');
    expect(rowFor(2)).toMatchObject({ closedReason: 'stopped_by_user' });
    expect(rowFor(2)?.closedAt).toEqual(new Date('2026-01-01'));
  });

  test('other tasks’ rows are untouched', async () => {
    await deleteTaskWithTrash(1, 'user');
    expect(rowFor(9)).toMatchObject({ closedAt: null, closedReason: null });
  });

  test('a delete that fails leaves the rows open (the close rolls back with it)', async () => {
    db.failNext('Task', 'delete', Object.assign(new Error('db down'), { code: 'P1001' }));
    await expect(deleteTaskWithTrash(1, 'user')).rejects.toThrow('db down');
    expect(db.tables.Task.map((t) => t.id)).toEqual([1, 2, 3, 9]);
    expect(rowFor(1)).toMatchObject({ closedAt: null, closedReason: null });
    expect(rowFor(3)).toMatchObject({ closedAt: null, closedReason: null });
  });

  test('a protected task is refused and its row stays open', async () => {
    db.tables.Task[0].isProtected = true;
    const result = await deleteTaskWithTrash(1, 'user');
    expect(result.outcome).toBe('protected');
    expect(rowFor(1)).toMatchObject({ closedAt: null });
  });
});

describe('a deep subtask chain is walked to the end (review fix2 item 4)', () => {
  /** Tasks 101..(100+n) in one line: each is the parent of the next. */
  function seedChain(n: number) {
    db = createMemoryDb();
    for (let i = 1; i <= n; i++) {
      db.tables.Task.push({
        id: 100 + i,
        title: `level ${i}`,
        parentId: i === 1 ? null : 100 + i - 1,
        isProtected: false,
        workspaceId: 4,
      });
      db.tables.TaskCompanion.push({
        id: i,
        taskId: 100 + i,
        origin: 'roadmap_commit',
        workspaceId: 4,
        closedAt: null,
        closedReason: null,
      });
    }
  }

  test('34 tasks in a straight line: deleting the top closes all 34 rows', async () => {
    // The review's reproduction: a 32-level cap stopped at the first 33.
    seedChain(34);
    const result = await deleteTaskWithTrash(101, 'user');
    expect(result.outcome).toBe('deleted');
    expect(db.tables.Task).toHaveLength(0);
    const open = db.tables.TaskCompanion.filter((r) => r.closedAt === null);
    expect(open.map((r) => r.taskId)).toEqual([]);
    expect(db.tables.TaskCompanion.every((r) => r.closedReason === 'task_deleted')).toBe(true);
    expect(db.tables.TaskCompanion).toHaveLength(34);
  });

  test('100 levels deep: the deepest row is closed too', async () => {
    seedChain(100);
    await deleteTaskWithTrash(101, 'user');
    expect(db.tables.TaskCompanion.find((r) => r.taskId === 200)).toMatchObject({
      closedReason: 'task_deleted',
    });
  });
});
