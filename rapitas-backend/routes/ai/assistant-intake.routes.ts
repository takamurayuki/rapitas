/**
 * Assistant Intake Routes
 *
 * The surface ラピ acts through. Every route here names a capability declared
 * in `services/assistant/capabilities.ts` and is checked against it before it
 * does anything, so what ラピ can do is a list someone wrote down rather than
 * whatever the REST API happens to expose.
 *
 * `POST /assistant/task-draft` proposes, and writes nothing.
 * `POST /assistant/task-create` is the only way ラピ creates a task, and it
 * refuses to run without the user's confirmation carried in the payload —
 * which is why the confirmation is a field rather than an assumption drawn
 * from the fact that a request arrived.
 *
 * Not responsible for deciding the draft — see `services/assistant/task-draft`.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { createTask } from '../../services/task/task-mutations';
import { deleteTaskWithTrash } from '../../services/task/task-deletion';
import {
  buildTaskDraft,
  readTaskIntent,
  assertCapabilityAllowed,
  recordAction,
  listRecentActions,
  ASSISTANT_CAPABILITIES,
  ConfirmationRequiredError,
} from '../../services/assistant';

const logger = createLogger('assistant-intake');

/** Keeps a stray paste from turning into a parse of a whole document. */
const MAX_TEXT_LENGTH = 2000;

export const assistantIntakeRoutes = new Elysia({ prefix: '/assistant' })
  .post(
    '/task-draft',
    async ({ body }) => {
      const themes = await prisma.theme.findMany({
        // The description is what lets a theme be chosen by what it is for
        // rather than by its name appearing in the sentence.
        select: { id: true, name: true, description: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });

      // Read the intent first. Pattern matching is the fallback, not the
      // plan: it can only find a theme whose name was said out loud, which
      // makes it a form with guessed fields rather than an assistant that
      // understood anything.
      const understood = await readTaskIntent(body.text, themes);
      const draft = understood ?? buildTaskDraft(body.text, themes);
      const source = understood ? 'intent' : 'patterns';

      // Recorded although nothing changed. "ラピ suggested this" belongs in
      // the trail, and a proposal the user walked away from leaves no other
      // trace anywhere.
      await recordAction({
        capabilityId: 'task.draft',
        status: 'proposed',
        args: { text: body.text },
        result: { source, title: draft.title, themeId: draft.themeId, missing: draft.missing },
      });

      // The UI says which reader produced this, because a fallback draft is
      // visibly weaker and the user should know why before trusting it.
      return { success: true, source, draft };
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
      }),
    },
  )

  .post(
    '/task-create',
    async ({ body, set }) => {
      // The gate. `confirmed` is carried in the payload rather than assumed
      // from the fact that a request arrived: a capability that changes data
      // has to be able to point at the moment a person agreed to it.
      try {
        assertCapabilityAllowed('task.create', { confirmed: body.confirmed });
      } catch (err) {
        if (err instanceof ConfirmationRequiredError) {
          // The most important row in the log: "ラピ wanted to do this and was
          // not allowed" exists nowhere else at all.
          await recordAction({
            capabilityId: 'task.create',
            status: 'refused',
            args: body.task,
            errorMessage: err.message,
          });
          set.status = 400;
          return { success: false, error: 'confirmation_required' };
        }
        throw err;
      }

      try {
        const task = await createTask(prisma, {
          title: body.task.title,
          themeId: body.task.themeId,
          status: 'todo',
          ...(body.task.description ? { description: body.task.description } : {}),
          ...(body.task.priority ? { priority: body.task.priority } : {}),
          ...(body.task.dueDate ? { dueDate: body.task.dueDate } : {}),
          ...(body.task.estimatedHours ? { estimatedHours: body.task.estimatedHours } : {}),
          // What "done" means, as the user approved it. Criteria nobody can
          // reach are a known source of endless verification bounce-backs, so
          // these are the ones that survived the confirmation card, not the
          // ones a model produced unseen.
          ...(body.task.acceptanceCriteria?.length
            ? { acceptanceCriteria: body.task.acceptanceCriteria }
            : {}),
        });

        await recordAction({
          capabilityId: 'task.create',
          status: 'executed',
          args: body.task,
          taskId: task?.id,
          result: { id: task?.id },
        });

        return { success: true, id: task?.id, task };
      } catch (err) {
        await recordAction({
          capabilityId: 'task.create',
          status: 'failed',
          args: body.task,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        logger.error({ err }, 'assistant task creation failed');
        set.status = 500;
        return { success: false, error: 'create_failed' };
      }
    },
    {
      body: t.Object({
        confirmed: t.Boolean(),
        task: t.Object({
          title: t.String({ minLength: 1, maxLength: 500 }),
          // Required, not optional: ラピ never guesses a theme, so a request
          // without one is malformed rather than something to fill in here.
          themeId: t.Number(),
          description: t.Optional(t.String({ maxLength: 20000 })),
          priority: t.Optional(t.String({ maxLength: 20 })),
          dueDate: t.Optional(t.String()),
          estimatedHours: t.Optional(t.Number()),
          acceptanceCriteria: t.Optional(t.Array(t.String({ maxLength: 500 }), { maxItems: 10 })),
        }),
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
  )

  .get('/capabilities', () => ({ success: true, capabilities: ASSISTANT_CAPABILITIES }))

  /** What ラピ has been asked to do lately, so the record is not write-only. */
  .get('/actions', async ({ query }) => ({
    success: true,
    capabilities: ASSISTANT_CAPABILITIES,
    actions: await listRecentActions(query.limit ? Number(query.limit) : undefined),
  }));

export default assistantIntakeRoutes;
