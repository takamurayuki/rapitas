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
import {
  buildTaskDraft,
  assertCapabilityAllowed,
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
        select: { id: true, name: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });

      const draft = buildTaskDraft(body.text, themes);

      return { success: true, draft };
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
        });

        return { success: true, id: task?.id, task };
      } catch (err) {
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
        }),
      }),
    },
  )

  .get('/capabilities', () => ({ success: true, capabilities: ASSISTANT_CAPABILITIES }));

export default assistantIntakeRoutes;
