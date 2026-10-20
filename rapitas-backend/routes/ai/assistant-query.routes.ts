/**
 * Assistant Query Routes
 *
 * What ラピ can tell you: answers about the backlog, the surface she is
 * allowed to act on, and the record of what she has done.
 *
 * `POST /assistant/ask` has the model turn a question into a query and never
 * into an answer, so every number comes from the database. She can be asked
 * the wrong thing; she cannot be confidently wrong about how many there are.
 *
 * Reads only — nothing here writes anything but its own audit row.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import {
  interpretQuestion,
  runTaskQuery,
  listRecentActions,
  recordAction,
  ASSISTANT_CAPABILITIES,
} from '../../services/assistant';
import { MAX_TEXT_LENGTH } from './assistant-intake.routes';

export const assistantQueryRoutes = new Elysia({ prefix: '/assistant' })
  .post(
    '/ask',
    async ({ body }) => {
      const themes = await prisma.theme.findMany({
        select: { id: true, name: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });

      const read = await interpretQuestion(body.text, themes);
      if (!read) {
        await recordAction({
          capabilityId: 'task.query',
          status: 'failed',
          args: { text: body.text },
          errorMessage: 'could not interpret',
        });
        // Said plainly rather than answered with an empty list, which would
        // read as "there are none".
        return { success: true, available: false };
      }

      const { total, rows } = await runTaskQuery(read.query);

      await recordAction({
        capabilityId: 'task.query',
        status: 'executed',
        args: { text: body.text },
        result: { query: read.query, total },
      });

      // The query travels with the answer: if the question was misread, the
      // conditions on screen are what makes that visible.
      return {
        success: true,
        available: true,
        query: read.query,
        total,
        rows,
        unclear: read.unclear,
      };
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
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

export default assistantQueryRoutes;
