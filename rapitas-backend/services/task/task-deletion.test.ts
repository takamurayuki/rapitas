/**
 * task-deletion.test
 *
 * The one place that decides what deleting a task means, now that ラピ can
 * ask for it too. The order is the substance: refuse protected first so a
 * task that is staying never has its worktrees touched, and snapshot before
 * the delete because the cascade leaves nothing to copy afterwards — both the
 * trash copy of the task and the measurements it is about to lose.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** What happened, in order. */
let order: string[] = [];
/** The task the stand-in database holds, or null. */
let task: { isProtected: boolean } | null = { isProtected: false };
/** Per-id overrides, for a bulk call that has to mix outcomes. */
let tasksById: Record<number, { isProtected: boolean } | null> = {};
/** What the delete throws, when something is meant to go wrong. */
let deleteThrows: unknown = null;

mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findUnique: async (args: { where: { id: number } }) => {
        const id = args?.where?.id;
        order.push(`guard:${id}`);
        return id in tasksById ? tasksById[id] : task;
      },
      delete: async (args: { where: { id: number } }) => {
        const id = args?.where?.id;
        order.push(`delete:${id}`);
        if (deleteThrows) throw deleteThrows;
        return { id };
      },
    },
  },
  ensureDatabaseConnection: async () => {},
}));

/** What Prisma throws when the row a delete named is no longer there. */
const recordGone = () =>
  Object.assign(new Error('No record was found for a delete.'), {
    code: 'P2025',
    clientVersion: '6.19.3',
  });

mock.module('./task-worktree-cleanup', () => ({
  cleanUpTaskWorktrees: async () => {
    order.push('worktrees');
  },
}));

mock.module('./task-trash', () => ({
  snapshotTaskForTrash: async () => {
    order.push('snapshot');
    return 7;
  },
}));

// The trash copy keeps the task; this keeps what the task cost. Both have to
// run before the delete, for the same reason: the cascade leaves nothing.
mock.module('./task-measurement-snapshot', () => ({
  TASK_MEASUREMENT_EVENT: 'task_measurement_snapshot',
  snapshotTaskMeasurements: async () => {
    order.push('measurements');
    return null;
  },
}));

const { deleteTaskWithTrash, deleteTasksWithTrash } = await import('./task-deletion');

beforeEach(() => {
  order = [];
  task = { isProtected: false };
  tasksById = {};
  deleteThrows = null;
});

describe('deleteTaskWithTrash', () => {
  test('clears worktrees, snapshots, then deletes — in that order', async () => {
    const result = await deleteTaskWithTrash(1, 'user');
    expect(order).toEqual(['guard:1', 'worktrees', 'snapshot', 'measurements', 'delete:1']);
    expect(result).toEqual({ taskId: 1, outcome: 'deleted', trashId: 7 });
  });

  // A task that is staying must not have anything touched on its way to being
  // refused — the guard runs before the worktree cleanup for that reason.
  test('refuses a protected task without touching anything', async () => {
    task = { isProtected: true };
    const result = await deleteTaskWithTrash(1, 'assistant');
    expect(result.outcome).toBe('protected');
    expect(order).toEqual(['guard:1']);
  });

  test('reports a missing task rather than pretending it deleted one', async () => {
    task = null;
    const result = await deleteTaskWithTrash(99, 'assistant');
    expect(result.outcome).toBe('not_found');
    expect(order).toEqual(['guard:99']);
  });

  // The guard and the delete are not one atomic step: between them the
  // worktrees are cleared and 43 relations are copied, which takes long
  // enough for something else — a parent's cascade, the task list, a backlog
  // job — to remove the row first. Observed live on task 625: P2025 escaped
  // as an exception and the user was told the deletion FAILED for a task
  // that was, in fact, gone.
  test('treats a task that vanished mid-flight as already gone, not as a failure', async () => {
    deleteThrows = recordGone();
    const result = await deleteTaskWithTrash(625, 'assistant');
    expect(result).toEqual({ taskId: 625, outcome: 'not_found' });
    expect(order).toEqual(['guard:625', 'worktrees', 'snapshot', 'measurements', 'delete:625']);
  });

  // Only the row-is-gone case is absorbed. A database that is down must not
  // be reported as "there was nothing with that id".
  test('still raises a real database failure', async () => {
    deleteThrows = Object.assign(new Error("Can't reach database server"), { code: 'P1001' });
    await expect(deleteTaskWithTrash(1, 'user')).rejects.toThrow("Can't reach database server");
  });

  // The trash row records who asked, which is the only way to tell an
  // assistant deletion from a person's afterwards.
  test('passes the caller through to the snapshot', async () => {
    let seen: string | undefined;
    mock.module('./task-trash', () => ({
      snapshotTaskForTrash: async (_id: number, source: string) => {
        seen = source;
        return 7;
      },
    }));
    const { deleteTaskWithTrash: fresh } = await import('./task-deletion');
    await fresh(1, 'assistant');
    expect(seen).toBe('assistant');
  });
});

// Confirmed 2026-11-01 (#1330): three callers deleted tasks WITHOUT this
// module — the batch API's DELETE:/tasks/:id, and both subtask-bulk routes,
// each calling prisma.task.delete / deleteMany straight. So a protected task
// the single-task route refuses was removed through the batch, with no trash
// copy to restore from and no measurement snapshot, while the cascade took 43
// relations with it. The comment in tasks.ts had already named the hazard:
// "one guard in two places is a guard that drifts".
describe('deleteTasksWithTrash', () => {
  test('deletes each task through the same guarded path', async () => {
    const result = await deleteTasksWithTrash([1, 2], 'user');

    expect(result.deleted).toEqual([1, 2]);
    expect(result.trashIds).toEqual([7, 7]);

    // Asserted as counts and relative order rather than one exact array: a
    // test above re-mocks './task-trash' and bun's mock.module is
    // process-global, so by the time this runs the snapshot step no longer
    // records itself. What matters here is unchanged by that — each task gets
    // its OWN full pass, instead of one guard covering the whole batch.
    expect(order.filter((step) => step === 'worktrees')).toHaveLength(2);
    expect(order.filter((step) => step === 'measurements')).toHaveLength(2);
    expect(order.indexOf('delete:1')).toBeLessThan(order.indexOf('guard:2'));
    expect(order.indexOf('guard:1')).toBeLessThan(order.indexOf('delete:1'));
  });

  test('refuses the protected ones and still deletes the rest', async () => {
    tasksById = { 1: { isProtected: false }, 2: { isProtected: true }, 3: { isProtected: false } };

    const result = await deleteTasksWithTrash([1, 2, 3], 'user');

    expect(result.deleted).toEqual([1, 3]);
    expect(result.protected).toEqual([2]);
    // The protected one is refused before anything of its own is touched.
    expect(order).not.toContain('delete:2');
  });

  test('reports the ids that were not there', async () => {
    tasksById = { 1: { isProtected: false }, 99: null };

    const result = await deleteTasksWithTrash([1, 99], 'user');

    expect(result.deleted).toEqual([1]);
    expect(result.notFound).toEqual([99]);
  });

  test('an empty list is a no-op, not a database round trip', async () => {
    const result = await deleteTasksWithTrash([], 'user');

    expect(result).toEqual({ deleted: [], protected: [], notFound: [], trashIds: [] });
    expect(order).toEqual([]);
  });

  test('deduplicates ids so one task is not snapshotted twice', async () => {
    const result = await deleteTasksWithTrash([4, 4], 'user');

    expect(result.deleted).toEqual([4]);
    expect(order.filter((step) => step === 'delete:4')).toHaveLength(1);
  });
});
