/**
 * Task Trash Routes
 *
 * Reading and undoing deletions.
 *
 * Mounted at `/task-trash` rather than `/tasks/trash` on purpose: the tasks
 * router already answers `/tasks/:id`, and `trash` would be swallowed by it
 * as an id before these ever ran.
 *
 * Not responsible for taking the snapshot — that happens in the delete path,
 * which is the only moment the data still exists. See `services/task/task-trash`.
 */
import { Elysia, t } from 'elysia';
import { listTrash, restoreFromTrash, purgeTrash } from '../../services/task/task-trash';

export const taskTrashRoutes = new Elysia({ prefix: '/task-trash' })
  .get('/', async ({ query }) => ({
    success: true,
    entries: await listTrash(query.limit ? Number(query.limit) : undefined),
  }))

  .post(
    '/:id/restore',
    async ({ params, set }) => {
      const restored = await restoreFromTrash(Number(params.id));
      if (!restored) {
        // Missing, already restored, or an unreadable snapshot. All three mean
        // "there is nothing here to bring back", and none should look like a
        // success that silently produced no task.
        set.status = 409;
        return { success: false, error: 'not_restorable' };
      }
      return { success: true, task: restored };
    },
    { params: t.Object({ id: t.String() }) },
  )

  .delete('/purge', async ({ query }) => ({
    success: true,
    ...(await purgeTrash(query.days ? Number(query.days) : undefined)),
  }));

export default taskTrashRoutes;
