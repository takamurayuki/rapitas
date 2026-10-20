/**
 * Assistant Cleanup Routes
 *
 * Clearing tasks away: working out which ones are meant, and removing the
 * list the user approved.
 *
 * Two ways in, because they answer different questions. `delete-draft` asks
 * a model which tasks are redundant, from a window it can hold — judgement.
 * `delete-filter` asks the database what matches a set of conditions, which
 * is the only instrument that reaches a theme of several hundred.
 *
 * Both only ever build a list. `POST /assistant/task-delete` runs against
 * explicit ids and refuses without confirmation, so nothing is removed that
 * was not on screen.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { deleteTaskWithTrash } from '../../services/task/task-deletion';
import {
  proposeDeletions,
  previewDeleteFilter,
  assertCapabilityAllowed,
  recordAction,
  CANDIDATE_WINDOW,
  ConfirmationRequiredError,
} from '../../services/assistant';
import { MAX_TEXT_LENGTH } from './assistant-intake.routes';

const logger = createLogger('assistant-cleanup');

export const assistantCleanupRoutes = new Elysia({ prefix: '/assistant' })
  .post(
    '/delete-filter',
    async ({ body }) => {
      const result = await previewDeleteFilter({
        themeId: body.themeId,
        statuses: body.statuses,
        updatedBeforeDays: body.updatedBeforeDays,
      });

      await recordAction({
        capabilityId: 'task.delete-filter',
        status: 'proposed',
        args: body,
        result: { total: result.total, returned: result.matches.length },
      });

      return { success: true, ...result };
    },
    {
      body: t.Object({
        themeId: t.Optional(t.Number()),
        statuses: t.Optional(t.Array(t.String({ maxLength: 40 }), { maxItems: 10 })),
        updatedBeforeDays: t.Optional(t.Number()),
      }),
    },
  )

  .post(
    '/delete-draft',
    async ({ body }) => {
      // A bounded, recently-touched window. There are over a thousand tasks;
      // a prompt that cannot hold them is a prompt that silently drops some,
      // and the count goes back to the caller so the UI can say what was
      // actually weighed rather than implying it covered everything.
      const tasks = await prisma.task.findMany({
        orderBy: { updatedAt: 'desc' },
        take: CANDIDATE_WINDOW,
        select: { id: true, title: true, status: true, themeId: true, updatedAt: true },
      });

      const proposal = await proposeDeletions(body.text, tasks);

      await recordAction({
        capabilityId: 'task.delete-draft',
        status: 'proposed',
        args: { text: body.text },
        result: {
          considered: proposal?.considered ?? tasks.length,
          proposed: proposal?.candidates.map((c) => c.id) ?? [],
        },
      });

      if (!proposal) {
        // No model, or nothing usable from it. Saying so beats a confident
        // empty list, which reads as "there is nothing to clean up".
        return { success: true, available: false, candidates: [], considered: tasks.length };
      }
      return { success: true, available: true, ...proposal };
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
      }),
    },
  )

  .post(
    '/task-delete',
    async ({ body, set }) => {
      try {
        assertCapabilityAllowed('task.delete', { confirmed: body.confirmed });
      } catch (err) {
        if (err instanceof ConfirmationRequiredError) {
          await recordAction({
            capabilityId: 'task.delete',
            status: 'refused',
            args: { taskIds: body.taskIds },
            errorMessage: err.message,
          });
          set.status = 400;
          return { success: false, error: 'confirmation_required' };
        }
        throw err;
      }

      // One id at a time, never a filter. ラピ may propose which tasks should
      // go, but what actually gets deleted is the list the user looked at and
      // approved — a filter evaluated server-side could match something that
      // was not on screen when they pressed the button.
      const results = [];
      for (const taskId of body.taskIds) {
        try {
          const result = await deleteTaskWithTrash(taskId, 'assistant');
          results.push(result);
          await recordAction({
            capabilityId: 'task.delete',
            status: result.outcome === 'deleted' ? 'executed' : 'refused',
            args: { taskId },
            taskId,
            result,
            ...(result.outcome === 'deleted' ? {} : { errorMessage: result.outcome }),
          });
        } catch (err) {
          // One task failing must not abandon the rest half-done; the caller
          // gets a per-task outcome either way.
          logger.error({ err, taskId }, 'assistant task deletion failed');
          results.push({ taskId, outcome: 'failed' as const });
          await recordAction({
            capabilityId: 'task.delete',
            status: 'failed',
            args: { taskId },
            taskId,
            errorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return { success: true, results };
    },
    {
      body: t.Object({
        confirmed: t.Boolean(),
        // Explicit, bounded, and never empty: there is no "delete everything
        // matching" shape to get wrong.
        taskIds: t.Array(t.Number(), { minItems: 1, maxItems: 50 }),
      }),
    },
  );

export default assistantCleanupRoutes;
