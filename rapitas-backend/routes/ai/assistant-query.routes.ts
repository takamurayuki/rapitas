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
  routeIntent,
  surveyBacklog,
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

  /**
   * What in the backlog is waiting for a person.
   *
   * No model in the path: every number is a count the database ran, so she
   * cannot be confidently wrong about how many tasks are stuck. The audit
   * row is recorded for the same reason the other reads record one — the
   * surface she is exercising should be visible even when it changes nothing.
   */
  .get('/supervision', async () => {
    const survey = await surveyBacklog();
    await recordAction({
      capabilityId: 'task.supervise',
      status: 'executed',
      args: {},
      result: {
        total: survey.total,
        byCategory: Object.fromEntries(survey.categories.map((c) => [c.category, c.total])),
      },
    });
    return { success: true, ...survey };
  })

  /**
   * Where a sentence should go.
   *
   * Decides only; the destination does the work and asks for its own
   * confirmation if it needs one. An answer of `routed: false` is a real
   * answer — she will not guess, and the tabs are still there.
   */
  .post(
    '/route',
    async ({ body }) => {
      const routed = await routeIntent(body.text, body.hasOpenTask ?? false);
      await recordAction({
        capabilityId: 'assistant.route',
        status: routed ? 'executed' : 'refused',
        args: { text: body.text, hasOpenTask: body.hasOpenTask ?? false },
        ...(routed ? { result: routed } : { errorMessage: 'no destination' }),
      });
      return routed ? { success: true, routed: true, ...routed } : { success: true, routed: false };
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
        hasOpenTask: t.Optional(t.Boolean()),
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
