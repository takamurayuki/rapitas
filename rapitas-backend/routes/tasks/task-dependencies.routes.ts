/**
 * Task dependency routes
 *
 * The tasks a task waits for before it starts (開始条件, #1559):
 *  - GET /tasks/:id/dependencies  — its prerequisites, each with its status
 *  - PUT /tasks/:id/dependencies  — replace them; refuses itself, unknown
 *    tasks and cycles with 400 and a message saying which
 * Not responsible for the start conditions in words (PATCH /tasks/:id).
 */
import { Elysia, t } from 'elysia';
import { parseId } from '../../middleware/error-handler';
import { listPrerequisites, setPrerequisites } from '../../services/task/task-dependencies';

export const taskDependencyRoutes = new Elysia({ prefix: '/tasks' })
  .get(
    '/:id/dependencies',
    async ({ params }) => ({
      success: true,
      prerequisites: await listPrerequisites(parseId(params.id, 'task ID')),
    }),
    { params: t.Object({ id: t.String() }) },
  )

  .put(
    '/:id/dependencies',
    async ({ params, body, set }) => {
      const taskId = parseId(params.id, 'task ID');
      const result = await setPrerequisites(taskId, body.dependsOn);
      if (!result.ok) {
        set.status = 400;
        return { success: false, code: result.code, error: result.message };
      }
      return { success: true, prerequisites: await listPrerequisites(taskId) };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        dependsOn: t.Array(t.Integer({ minimum: 1 }), { maxItems: 50 }),
      }),
    },
  );

export default taskDependencyRoutes;
