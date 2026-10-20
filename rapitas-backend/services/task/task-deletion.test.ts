/**
 * task-deletion.test
 *
 * The one place that decides what deleting a task means, now that ラピ can
 * ask for it too. The order is the substance: refuse protected first so a
 * task that is staying never has its worktrees touched, and snapshot before
 * the delete because the cascade leaves nothing to copy afterwards.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** What happened, in order. */
let order: string[] = [];
/** The task the stand-in database holds, or null. */
let task: { isProtected: boolean } | null = { isProtected: false };

mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findUnique: async () => {
        order.push('guard');
        return task;
      },
      delete: async () => {
        order.push('delete');
        return { id: 1 };
      },
    },
  },
  ensureDatabaseConnection: async () => {},
}));

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

const { deleteTaskWithTrash } = await import('./task-deletion');

beforeEach(() => {
  order = [];
  task = { isProtected: false };
});

describe('deleteTaskWithTrash', () => {
  test('clears worktrees, snapshots, then deletes — in that order', async () => {
    const result = await deleteTaskWithTrash(1, 'user');
    expect(order).toEqual(['guard', 'worktrees', 'snapshot', 'delete']);
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
