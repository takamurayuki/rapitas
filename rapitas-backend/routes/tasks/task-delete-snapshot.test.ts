/**
 * task-delete-snapshot.test
 *
 * The one ordering that matters in the whole trash feature: the snapshot is
 * taken BEFORE the delete. Afterwards the cascade has removed the task and
 * its subtasks, and there is nothing left to copy — a snapshot taken a line
 * too late would record nothing and look exactly like one that worked.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** Everything that happened, in order. */
let order: string[] = [];
/** Whether the task under test is protected from deletion. */
let isProtected = false;

mock.module('../../services/task/task-trash', () => ({
  snapshotTaskForTrash: async () => {
    order.push('snapshot');
    return 1;
  },
}));

mock.module('../../config/database', () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, model: string) =>
        new Proxy(
          {},
          {
            get: (_t2, method: string) => async () => {
              const call = `${model}.${String(method)}`;
              if (call === 'task.findUnique') return { id: 1, isProtected };
              if (call === 'task.delete') {
                order.push('delete');
                return { id: 1 };
              }
              if (method === 'findMany') return [];
              return null;
            },
          },
        ),
    },
  ),
  ensureDatabaseConnection: async () => {},
}));

const { tasksRoutes } = await import('./tasks');

async function del(id: number) {
  const res = await tasksRoutes.handle(
    new Request(`http://localhost/tasks/${id}`, { method: 'DELETE' }),
  );
  return res.status;
}

beforeEach(() => {
  order = [];
  isProtected = false;
});

describe('DELETE /tasks/:id', () => {
  test('snapshots the task before deleting it', async () => {
    await del(1);
    expect(order).toEqual(['snapshot', 'delete']);
  });

  // The guard predates the trash and must still win: a protected task is not
  // deleted, so it has no business appearing in the trash either.
  test('neither snapshots nor deletes a protected task', async () => {
    isProtected = true;
    const status = await del(1);
    expect(status).toBe(409);
    expect(order).toEqual([]);
  });
});
