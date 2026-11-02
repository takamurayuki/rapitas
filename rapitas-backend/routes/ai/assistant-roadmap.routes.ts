/**
 * Assistant Roadmap Routes
 *
 * Talking something over with ラピ until it is a set of tasks.
 *
 * Two calls, deliberately. `POST /assistant/roadmap/draft` reads the themes
 * and projects that exist, has the model propose where the work belongs and
 * what it breaks into, and writes nothing. `POST /assistant/roadmap/commit`
 * takes the plan back — the one the user read — and creates it, with no
 * model anywhere in the path.
 *
 * `draft` is called twice, which is the point of `answers`: the first call
 * asks what it needs to know, the second is handed what the user picked and
 * plans against it. Before that, the questions were decorative — the plan
 * was already drafted when they were answered, so whatever was chosen, the
 * same tasks were created.
 *
 * That split is the safety argument. The drafting half can be wrong and
 * costs only attention; the creating half does exactly what was on screen.
 *
 * The note that ends the flow is not written here. Notes in this app live in
 * the browser's own storage with no server table behind them, so the client
 * composes and stores it from the goal, the answers and the tasks this
 * returned.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import {
  draftRoadmap,
  commitRoadmap,
  MAX_ROADMAP_QUESTIONS,
  assertCapabilityAllowed,
  recordAction,
  ConfirmationRequiredError,
  type ApprovedPlacement,
} from '../../services/assistant';
import { MAX_TEXT_LENGTH } from './assistant-intake.routes';

/** A placement as the payload states it, before it is trusted as a plan. */
const placement = t.Union([
  t.Object({ kind: t.Literal('existing'), id: t.Number(), name: t.Optional(t.String()) }),
  t.Object({ kind: t.Literal('new'), name: t.String(), reason: t.Optional(t.String()) }),
  t.Object({ kind: t.Literal('none'), reason: t.Optional(t.String()) }),
]);

export const assistantRoadmapRoutes = new Elysia({ prefix: '/assistant/roadmap' })
  .post(
    '/draft',
    async ({ body }) => {
      // Descriptions as well as names: a theme is chosen by what it is for,
      // not by its name appearing in the sentence.
      const [themes, projects] = await Promise.all([
        prisma.theme.findMany({
          select: { id: true, name: true, description: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        }),
        prisma.project.findMany({
          select: { id: true, name: true, description: true },
          orderBy: { id: 'asc' },
        }),
      ]);

      const answers = body.answers ?? [];
      const draft = await draftRoadmap(
        body.text,
        { themes, projects },
        answers.length > 0 ? { answers } : {},
      );
      await recordAction({
        capabilityId: 'roadmap.draft',
        status: draft ? 'executed' : 'failed',
        args: { text: body.text, answers: answers.length },
        ...(draft
          ? { result: { goal: draft.goal, steps: draft.steps.length } }
          : { errorMessage: 'could not draft' }),
      });

      // Said plainly rather than answered with an empty plan, which would
      // read as "there is nothing to do".
      if (!draft) return { success: true, available: false };
      return { success: true, available: true, draft };
    },
    {
      body: t.Object({
        text: t.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
        // Bounded by what the first round is allowed to ask, so a payload
        // cannot turn the final round into an unbounded prompt.
        answers: t.Optional(
          t.Array(
            t.Object({
              question: t.String({ minLength: 1, maxLength: 200 }),
              answer: t.String({ minLength: 1, maxLength: 200 }),
            }),
            { maxItems: MAX_ROADMAP_QUESTIONS },
          ),
        ),
      }),
    },
  )

  .post(
    '/commit',
    async ({ body, set }) => {
      try {
        assertCapabilityAllowed('roadmap.commit', { confirmed: body.confirmed });
      } catch (err) {
        if (err instanceof ConfirmationRequiredError) {
          await recordAction({
            capabilityId: 'roadmap.commit',
            status: 'refused',
            args: { goal: body.goal, steps: body.steps.length },
            errorMessage: err.message,
          });
          set.status = 400;
          return { success: false, error: 'confirmation_required' };
        }
        throw err;
      }

      const result = await commitRoadmap({
        goal: body.goal,
        themeChoice: body.themeChoice as ApprovedPlacement,
        projectChoice: body.projectChoice as ApprovedPlacement,
        steps: body.steps,
      });

      await recordAction({
        capabilityId: 'roadmap.commit',
        status: result.failedAfter === null ? 'executed' : 'failed',
        args: { goal: body.goal, steps: body.steps.length },
        result,
        ...(result.failedAfter === null
          ? {}
          : { errorMessage: `stopped after ${result.failedAfter}` }),
      });

      return { success: true, ...result };
    },
    {
      body: t.Object({
        confirmed: t.Boolean(),
        goal: t.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
        themeChoice: placement,
        projectChoice: placement,
        // Bounded for the same reason the draft caps its own output: a
        // payload is not a backlog import.
        steps: t.Array(
          t.Object({
            title: t.String({ minLength: 1, maxLength: 200 }),
            description: t.String({ maxLength: MAX_TEXT_LENGTH }),
            // The shape `dueDate` is stored in, checked here rather than
            // trusted: a malformed date reaches Prisma as an Invalid Date.
            //
            // `[0-9]` rather than `\d`: in a single-quoted TypeScript string
            // `\d` is just `d`, so this read `^d{4}-d{2}-d{2}$` and rejected
            // every real date while accepting the literal "dddd-dd-dd".
            // Every commit carrying a dated step answered 400 — the whole
            // roadmap flow, once the deadline work started dating them.
            // Character classes carry no backslash and cannot fail this way,
            // which is why the rest of the schemas in this repo use them.
            dueDate: t.Optional(t.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' })),
          }),
          { minItems: 0, maxItems: 20 },
        ),
      }),
    },
  );

export default assistantRoadmapRoutes;
