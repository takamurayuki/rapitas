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
/** What the delete throws, when something is meant to go wrong. */
let deleteThrows: unknown = null;

mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findUnique: async () => {
        order.push('guard');
        return task;
      },
      delete: async () => {
        order.push('delete');
        if (deleteThrows) throw deleteThrows;
        return { id: 1 };
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

const { deleteTaskWithTrash } = await import('./task-deletion');

beforeEach(() => {
  order = [];
  task = { isProtected: false };
  deleteThrows = null;
});

describe('deleteTaskWithTrash', () => {
  test('clears worktrees, snapshots, then deletes — in that order', async () => {
    const result = await deleteTaskWithTrash(1, 'user');
    expect(order).toEqual(['guard', 'worktrees', 'snapshot', 'measurements', 'delete']);
    expect(result).toEqual({ taskId: 1, outcome: 'deleted', trashId: 7 });
  });

  // A task that is staying must not have anything touched on its way to being
  // refused — the guard runs before the worktree cleanup for that reason.
  test('refuses a protected task without touching anything', async () => {
    task = { isProtected: true };
    const result = await deleteTaskWithTrash(1, 'assistant');
    expect(result.outcome).toBe('protected');
    expect(order).toEqual(['guard']);
  });

  test('reports a missing task rather than pretending it deleted one', async () => {
    task = null;
    const result = await deleteTaskWithTrash(99, 'assistant');
    expect(result.outcome).toBe('not_found');
    expect(order).toEqual(['guard']);
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
    expect(order).toEqual(['guard', 'worktrees', 'snapshot', 'measurements', 'delete']);
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
