/**
 * ProfileInterview
 *
 * Asking the user who they are, a round at a time, and writing the answers
 * up as the introduction ラピ plans against.
 *
 * The settings card used to be two empty boxes. An empty box asks the user
 * to work out for themselves which facts a planner needs and to write them
 * in one sitting — the interview the profile was supposed to make
 * unnecessary, run by the person on themselves. This asks instead, with
 * choices, and comes back for another round that digs into what the first
 * one turned up (asked for 2026-10-30, #1281).
 *
 * Writes nothing, like the roadmap half it is modelled on. The questions are
 * invented and the write-up is invented, so both are shown before anything
 * is stored: the user applies the draft to the card and saves it themselves.
 * A bad interview costs attention; it cannot cost the paragraph they already
 * wrote.
 *
 * Rounds rather than a conversation: ラピ has no memory between messages, so
 * every round is handed back every answer so far. That is also what makes
 * "deeper" mean anything — a round that was not given the previous answers
 * could only ask round one's questions again.
 *
 * Not responsible for storing any of it — see `rapi-profile-store.ts` — nor
 * for what the roadmap then does with it, which is `roadmap-prompts.ts`.
 */
import { sendAIMessage } from '../../utils/ai-client';
import { createLogger } from '../../config/logger';
import { MAX_RAPI_PROFILE_LENGTH } from '../system/rapi-profile-store';
import {
  MAX_PROFILE_QUESTIONS,
  MAX_PROFILE_ROUNDS,
  PROFILE_ASK_PROMPT,
  PROFILE_COMPOSE_PROMPT,
  PROFILE_DEEPEN_PROMPT,
  buildProfileMessage,
  type ProfileAnswer,
} from './profile-prompts';
import { asText, extractJson, resolveQuestions } from './roadmap-resolve';
import type { RoadmapQuestion } from './roadmap-types';

const logger = createLogger('assistant-profile-interview');

export { MAX_PROFILE_QUESTIONS, MAX_PROFILE_ROUNDS };
export type { ProfileAnswer };

/**
 * One question as ラピ asked it.
 *
 * The same shape the roadmap interview uses, deliberately: the screen that
 * asks these is the same component, and two shapes would mean two of it.
 */
export type ProfileQuestion = RoadmapQuestion;

/** The two halves she wrote, each present only when she wrote it. */
export interface ProfileComposition {
  profile?: string;
  character?: string;
}

/** What the model returned for a write-up, before any of it is believed. */
interface RawComposition {
  profile?: unknown;
  character?: unknown;
}

/** What the model returned for a round of questions. */
interface RawQuestions {
  questions?: unknown;
}

/**
 * Ask the model, and return the raw JSON it answered with.
 *
 * Failing soft is the whole point: the local model is often simply not
 * running, and a settings card that says "ラピに聞けませんでした" is a far
 * better outcome than one that blocks on it or shows an invented answer.
 *
 * @param systemPrompt - Which of the three jobs this is / どの役割か
 * @param content - What is already known and what was answered / 既知の情報と回答
 * @returns The parsed object, or null when nothing usable came back / 解析結果（無ければ null）
 */
async function ask<T>(systemPrompt: string, content: string): Promise<T | null> {
  try {
    const response = await sendAIMessage({
      provider: 'ollama',
      systemPrompt,
      maxTokens: 2048,
      messages: [{ role: 'user', content }],
    });
    return extractJson<T>(response.content);
  } catch (err) {
    logger.info({ err }, 'profile interview unavailable');
    return null;
  }
}

/**
 * Ask the next round of questions about the person.
 *
 * Hand back every answer collected so far and the round goes deeper instead
 * of starting over; hand back none and it asks the opening questions.
 *
 * @param input - What is already known, and every answer so far / 既知の情報と回答
 * @returns The questions, `[]` when there is nothing left to ask, or null when ラピ could not be reached / 質問（無ければ空配列、到達不能なら null）
 */
export async function askProfileQuestions(input: {
  profile?: string | null;
  character?: string | null;
  answers?: ProfileAnswer[];
}): Promise<ProfileQuestion[] | null> {
  const answers = input.answers ?? [];
  const deeper = answers.length > 0;
  const raw = await ask<RawQuestions>(
    deeper ? PROFILE_DEEPEN_PROMPT : PROFILE_ASK_PROMPT,
    buildProfileMessage({
      profile: input.profile ?? null,
      character: input.character ?? null,
      ...(deeper ? { answers } : {}),
    }),
  );
  if (!raw) return null;

  // Capped again on top of resolveQuestions' own bound: that one is the
  // roadmap's, and a round here is a sitting rather than the whole
  // interview.
  const questions = resolveQuestions(raw.questions).slice(0, MAX_PROFILE_QUESTIONS);
  logger.info({ deeper, answers: answers.length, questions: questions.length }, 'profile asked');
  return questions;
}

/**
 * Draft the two halves of the introduction from the answers.
 *
 * @param input - Every answer, and what the user has already written / 回答と既存の自己紹介
 * @returns The draft, or null when there is nothing to write / 下書き（書けなければ null）
 */
export async function composeProfile(input: {
  answers: ProfileAnswer[];
  profile?: string | null;
  character?: string | null;
}): Promise<ProfileComposition | null> {
  // Nothing to build from. Asking anyway would invent a person, and the
  // invention would then be the thing every roadmap is planned against.
  if (input.answers.length === 0) return null;

  const raw = await ask<RawComposition>(
    PROFILE_COMPOSE_PROMPT,
    buildProfileMessage({
      profile: input.profile ?? null,
      character: input.character ?? null,
      answers: input.answers,
    }),
  );
  if (!raw) return null;

  const profile = asText(raw.profile, MAX_RAPI_PROFILE_LENGTH);
  const character = asText(raw.character, MAX_RAPI_PROFILE_LENGTH);
  // A half she left blank must stay absent rather than arrive as empty
  // text: applied to the card, empty text clears a paragraph the user wrote
  // by hand.
  if (!profile && !character) return null;

  logger.info(
    {
      answers: input.answers.length,
      profile: profile?.length ?? 0,
      character: character?.length ?? 0,
    },
    'profile drafted',
  );
  return {
    ...(profile ? { profile } : {}),
    ...(character ? { character } : {}),
  };
}
