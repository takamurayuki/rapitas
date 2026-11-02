/**
 * Assistant Profile Routes
 *
 * Letting ラピ ask who you are, instead of leaving you an empty box.
 *
 * Two calls, both read-only. `POST /assistant/profile/questions` returns the
 * next round of multiple-choice questions — handed the answers so far, it
 * digs into them rather than starting over. `POST /assistant/profile/compose`
 * turns those answers into the two halves of the introduction.
 *
 * Neither stores anything. The draft goes back to the settings card, which
 * puts it in the boxes only when the user says so and saves through
 * `PATCH /settings` like any other edit. That is the safety argument: the
 * model shapes what is proposed, and the paragraph the user already wrote
 * can only be replaced by the user.
 *
 * What is already known comes from the caller when it sends it and from the
 * stored row when it does not. The card sends its current text, unsaved
 * edits included — asking against the row instead would ask about a
 * paragraph that has just been rewritten on screen.
 *
 * The audit rows carry counts, never content. These answers are a person's
 * job, hours, money and health, and the log needs to record that a round
 * happened, not what was in it.
 */
import { Elysia, t } from 'elysia';
import {
  askProfileQuestions,
  composeProfile,
  recordAction,
  MAX_PROFILE_QUESTIONS,
  MAX_PROFILE_ROUNDS,
  type ProfileAnswer,
} from '../../services/assistant';
import {
  MAX_RAPI_PROFILE_LENGTH,
  readRapiCharacter,
  readRapiProfile,
} from '../../services/system/rapi-profile-store';

/**
 * One answer as the payload states it.
 *
 * Bounded at both ends: these are the model's own options coming back, so
 * anything long is not an answer this interview produced.
 */
const answer = t.Object({
  question: t.String({ minLength: 1, maxLength: 200 }),
  answer: t.String({ minLength: 1, maxLength: 200 }),
});

/** Every answer one interview can produce, and no more. */
const MAX_ANSWERS = MAX_PROFILE_QUESTIONS * MAX_PROFILE_ROUNDS;

/** The halves as the card currently shows them, when it sends them. */
const known = {
  profile: t.Optional(t.String({ maxLength: MAX_RAPI_PROFILE_LENGTH })),
  character: t.Optional(t.String({ maxLength: MAX_RAPI_PROFILE_LENGTH })),
};

/**
 * What ラピ should take as already known.
 *
 * An absent key means the caller has nothing to say about it and the stored
 * row is read; an empty string is the caller saying the box is empty, which
 * is information rather than an absence.
 *
 * @param body - The payload's two optional halves / 任意の2つの値
 * @returns What to put in front of the model / モデルに渡す既知の情報
 */
async function resolveKnown(body: {
  profile?: string;
  character?: string;
}): Promise<{ profile: string | null; character: string | null }> {
  return {
    profile: body.profile ?? (await readRapiProfile()),
    character: body.character ?? (await readRapiCharacter()),
  };
}

export const assistantProfileRoutes = new Elysia({ prefix: '/assistant/profile' })
  .post(
    '/questions',
    async ({ body }) => {
      const answers = (body.answers ?? []) as ProfileAnswer[];
      const known = await resolveKnown(body);
      const questions = await askProfileQuestions({ ...known, answers });

      await recordAction({
        capabilityId: 'profile.interview',
        status: questions ? 'executed' : 'failed',
        // Counts only — see this file's header.
        args: { answers: answers.length },
        ...(questions
          ? { result: { questions: questions.length } }
          : { errorMessage: 'could not ask' }),
      });

      // Said plainly rather than answered with an empty round, which reads
      // as "there is nothing more to ask" — the opposite of "ラピ is not
      // reachable right now".
      if (!questions) return { success: true, available: false };
      // The limit travels with the round rather than being restated on the
      // screen: the card decides whether to offer another round from it, and
      // a copy of the number there would be the one that drifts.
      return { success: true, available: true, questions, maxRounds: MAX_PROFILE_ROUNDS };
    },
    {
      body: t.Object({
        ...known,
        answers: t.Optional(t.Array(answer, { maxItems: MAX_ANSWERS })),
      }),
    },
  )

  .post(
    '/compose',
    async ({ body }) => {
      const answers = body.answers as ProfileAnswer[];
      const known = await resolveKnown(body);
      const draft = await composeProfile({ ...known, answers });

      await recordAction({
        capabilityId: 'profile.draft',
        status: draft ? 'executed' : 'failed',
        args: { answers: answers.length },
        ...(draft
          ? {
              result: {
                profile: draft.profile?.length ?? 0,
                character: draft.character?.length ?? 0,
              },
            }
          : { errorMessage: 'could not draft' }),
      });

      if (!draft) return { success: true, available: false };
      return { success: true, available: true, draft };
    },
    {
      body: t.Object({
        ...known,
        // Required and non-empty: an introduction written from no answers
        // would be invented, and the invention becomes the premise of every
        // roadmap after it.
        answers: t.Array(answer, { minItems: 1, maxItems: MAX_ANSWERS }),
      }),
    },
  );

export default assistantProfileRoutes;
