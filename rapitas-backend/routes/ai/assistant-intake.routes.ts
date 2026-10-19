/**
 * Assistant Intake Routes
 *
 * What ラピ hears from the user, turned into a proposal.
 *
 * `POST /assistant/task-draft` reads the themes and returns a draft task. It
 * is the first capability ラピ has that is not pure display, and it was chosen
 * first precisely because it cannot damage anything: it performs no write of
 * any kind. Filing the draft is a separate, explicit act by the user through
 * the ordinary task routes.
 *
 * Not responsible for deciding the draft — see `services/assistant/task-draft`.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { buildTaskDraft } from '../../services/assistant';

/** Keeps a stray paste from turning into a parse of a whole document. */
const MAX_TEXT_LENGTH = 2000;

export const assistantIntakeRoutes = new Elysia({ prefix: '/assistant' }).post(
  '/task-draft',
  async ({ body }) => {
    const themes = await prisma.theme.findMany({
      select: { id: true, name: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    return { success: true, draft: buildTaskDraft(body.text, themes) };
  },
  {
    body: t.Object({
      text: t.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
    }),
  },
);

export default assistantIntakeRoutes;
