/**
 * Assistant Research Routes
 *
 * `POST /assistant/research` — look candidates up on the web.
 *
 * Its own route rather than a flag on the roadmap draft, because it is the
 * only thing ラピ does that reaches outside this machine, and that is worth
 * being able to see in one place: in the capability log, in the server log,
 * and here. Everything else she runs has the network switched off.
 *
 * Writes nothing. What comes back is shown, and only becomes part of a note
 * if the user goes on to create the roadmap.
 *
 * Slow by nature — searching is several round-trips — so the service sets
 * its own ceiling rather than the one a text call gets.
 */
import { Elysia, t } from 'elysia';
// Imported from their own modules rather than the assistant barrel: a test
// that replaces the barrel loses every other export with it, and the first
// thing that notices is an unrelated route failing to import.
import { researchCandidates } from '../../services/assistant/research';
import { recordAction } from '../../services/assistant/action-log';

/** The same cap the other assistant routes put on a free-text field. */
const MAX_TEXT_LENGTH = 2000;

/** Matches the drafting half's own cap on how many axes a plan may carry. */
const MAX_AXES = 6;

export const assistantResearchRoutes = new Elysia({ prefix: '/assistant' }).post(
  '/research',
  async ({ body }) => {
    const findings = await researchCandidates({
      goal: body.goal,
      axes: body.axes,
      ...(body.decisions ? { decisions: body.decisions } : {}),
    });

    await recordAction({
      capabilityId: 'research.candidates',
      status: findings ? 'executed' : 'failed',
      args: { goal: body.goal, axes: body.axes.length },
      ...(findings
        ? {
            result: {
              candidates: findings.candidates.length,
              unresolved: findings.unresolvedAxes.length,
            },
          }
        : { errorMessage: 'could not research' }),
    });

    // Said plainly rather than answered with an empty list, which would
    // read as "there is nothing out there".
    if (!findings) return { success: true, available: false };
    return { success: true, available: true, findings };
  },
  {
    body: t.Object({
      goal: t.String({ minLength: 1, maxLength: MAX_TEXT_LENGTH }),
      axes: t.Array(t.String({ minLength: 1, maxLength: 120 }), {
        minItems: 1,
        maxItems: MAX_AXES,
      }),
      decisions: t.Optional(
        t.Array(
          t.Object({
            question: t.String({ minLength: 1, maxLength: 200 }),
            answer: t.String({ minLength: 1, maxLength: 200 }),
          }),
          { maxItems: 6 },
        ),
      ),
    }),
  },
);

export default assistantResearchRoutes;
