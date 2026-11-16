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
import {
  criteriaFromDescription,
  normalizeCriteria,
  splitByVerifier,
  descriptionForJury,
  ACCEPTANCE_CRITERIA_REQUIRED,
  MAX_CRITERIA,
  MAX_CRITERION_LENGTH,
} from '../../services/assistant/criteria-proposal';
import { linkCompanionSource, type CompanionDb } from '../../services/companion';

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

      // Every step must carry criteria before anything is created. A client
      // that predates the field still sends the description it showed, whose
      // `## 完了条件` checklist is the same approved text.
      //
      // Both arrays are re-split by the server's rules (design 4.1 案1): the
      // jury's go to acceptanceCriteria, the person's to userAcceptanceChecks.
      //
      // NOTE: The stored description's `## 完了条件` is re-composed from the
      // jury's criteria alone, every time. The jury, the workflow agents and
      // replanning read the description verbatim, so a person's check left in
      // its checklist reached the jury's prompt even with the columns split
      // (review fix3 item 1). The person's checks live in their column only;
      // the task screen shows them from there.
      const steps = body.steps.map((step) => {
        const listed = criteriaFromDescription(step.description);
        const sent = normalizeCriteria([
          ...(step.acceptanceCriteria ?? []),
          ...(step.userAcceptanceChecks ?? []),
        ]);
        const confirmed = sent.length ? sent : listed;
        const split = splitByVerifier({
          title: step.title,
          description: step.description,
          proposed: confirmed,
        });
        return {
          ...step,
          description: descriptionForJury(step.description, split, { section: 'always' }),
          acceptanceCriteria: split.acceptanceCriteria,
          userAcceptanceChecks: split.userAcceptanceChecks,
          confirmedCount: confirmed.length,
        };
      });
      const lacking = steps.flatMap((step, i) => (step.confirmedCount ? [] : [i]));
      if (lacking.length > 0) {
        await recordAction({
          capabilityId: 'roadmap.commit',
          status: 'refused',
          args: { goal: body.goal, steps: body.steps.length, stepsWithoutCriteria: lacking },
          errorMessage: ACCEPTANCE_CRITERIA_REQUIRED,
        });
        set.status = 400;
        return { success: false, error: ACCEPTANCE_CRITERIA_REQUIRED, steps: lacking };
      }

      const result = await commitRoadmap({
        goal: body.goal,
        themeChoice: body.themeChoice as ApprovedPlacement,
        projectChoice: body.projectChoice as ApprovedPlacement,
        steps: steps.map(({ confirmedCount: _count, ...step }) => step),
        milestones: body.milestones ?? [],
      });

      const actionId = await recordAction({
        capabilityId: 'roadmap.commit',
        status: result.failedAfter === null ? 'executed' : 'failed',
        args: { goal: body.goal, steps: body.steps.length },
        result,
        ...(result.failedAfter === null
          ? {}
          : { errorMessage: `stopped after ${result.failedAfter}` }),
      });
      // Best-effort pointer from each row to this act; the rows themselves
      // were written with their tasks.
      await linkCompanionSource(prisma as unknown as CompanionDb, result.taskIds, actionId).catch(
        () => undefined,
      );

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
            // Optional in the schema so an older client is read from its
            // description instead of rejected outright; required in effect.
            acceptanceCriteria: t.Optional(
              t.Array(t.String({ maxLength: MAX_CRITERION_LENGTH }), { maxItems: MAX_CRITERIA }),
            ),
            // The person's checks, sent apart by a client that shows the
            // split. Re-split by the server either way.
            userAcceptanceChecks: t.Optional(
              t.Array(t.String({ maxLength: MAX_CRITERION_LENGTH }), { maxItems: MAX_CRITERIA }),
            ),
            // Which approved milestone this step builds towards. Declared, or
            // t.Object would drop it and every task would be created unfiled.
            milestoneIndex: t.Optional(t.Integer({ minimum: 0, maximum: 19 })),
          }),
          { minItems: 0, maxItems: 20 },
        ),
        // The approved milestones (節目); created only when there is a project.
        milestones: t.Optional(
          t.Array(
            t.Object({
              name: t.String({ minLength: 1, maxLength: 200 }),
              acceptanceCriteria: t.Array(t.String({ maxLength: MAX_CRITERION_LENGTH }), {
                maxItems: MAX_CRITERIA,
              }),
              dueDate: t.Optional(t.String({ pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' })),
            }),
            { maxItems: 20 },
          ),
        ),
      }),
    },
  );

export default assistantRoadmapRoutes;
