/**
 * RoadmapDraft
 *
 * Turning "I want to do X" into a plan: where the work belongs, what it
 * breaks into, and what ラピ still needs to be told.
 *
 * Writes nothing. That is what makes it safe to let a model shape the whole
 * thing — the goal it restates, the placement it proposes, the steps it
 * invents and the questions it asks are all shown before a second, confirmed
 * call creates anything. A bad draft costs attention; it cannot cost data.
 *
 * Themes and projects are proposed independently, because that is what they
 * are. A task carries `themeId` and `projectId` side by side with no relation
 * between the two: a theme is where the work happens (its repository, branch
 * and auto-run scope) and a project is which body of work it belongs to (it
 * carries the milestones). The request's flow reads as a hierarchy; the data
 * model has none, and inventing one here would put tasks in the wrong place
 * for the rest of the app.
 *
 * Two rounds, not a conversation: ラピ has no memory between messages, so
 * the first round asks everything it needs at once and the second is handed
 * the answers back. The first version of this had only one round — it asked
 * good questions and then ignored them, because the plan had already been
 * drafted before the user answered anything. Whatever they picked, the same
 * tasks were created.
 *
 * The questions follow the house rules the workflow already uses — two to
 * four choices, with a recommendation and a reason for it, because a choice
 * offered without one hands the decision back without helping make it.
 *
 * Not responsible for creating anything — see the commit half.
 */
import { sendAIMessage } from '../../utils/ai-client';
import { readRapiCharacter, readRapiProfile } from '../system/rapi-profile-store';
import { createLogger } from '../../config/logger';
import {
  INTERVIEW_PROMPT,
  PLAN_PROMPT,
  MAX_ROADMAP_STEPS,
  MAX_ROADMAP_QUESTIONS,
  buildRoadmapMessage,
  type NamedRef,
  type RoadmapAnswer,
} from './roadmap-prompts';
import {
  asDayCount,
  asText,
  dayAfter,
  extractJson,
  resolveList,
  resolvePlacement,
  resolveQuestions,
  resolveSteps,
  MAX_TITLE,
  composeDescription,
  type RawDraft,
} from './roadmap-resolve';
import type {
  Placement,
  RoadmapDraft,
  RoadmapQuestion,
  RoadmapRound,
  RoadmapStep,
} from './roadmap-types';

const logger = createLogger('assistant-roadmap');

/** Most assumptions or comparison axes one plan may carry into the note. */
const MAX_NOTE_ITEMS = 6;

// Re-exported so every importer still has one place to ask for the roadmap
// shapes, whichever file now defines them.
export { MAX_ROADMAP_STEPS, MAX_ROADMAP_QUESTIONS, composeDescription };
export type {
  NamedRef,
  RoadmapAnswer,
  Placement,
  RoadmapDraft,
  RoadmapQuestion,
  RoadmapRound,
  RoadmapStep,
};
/**
 * Draft a plan for something the user wants to do.
 *
 * @param text - What they said they want / やりたいこと
 * @param world - The themes and projects that already exist / 既存のテーマとプロジェクト
 * @param round - The answers from the first round, if this is the second / 1巡目の回答
 * @returns The plan, or null when nothing usable came back / 計画（作れなければ null）
 */
export async function draftRoadmap(
  text: string,
  world: { themes: NamedRef[]; projects: NamedRef[] },
  round: RoadmapRound = {},
): Promise<RoadmapDraft | null> {
  const utterance = text.trim();
  if (!utterance) return null;

  const today = round.today ?? new Date();
  const answers = round.answers ?? [];
  const isFinal = answers.length > 0;

  let raw: RawDraft | null = null;
  try {
    const response = await sendAIMessage({
      provider: 'ollama',
      systemPrompt: isFinal ? PLAN_PROMPT : INTERVIEW_PROMPT,
      maxTokens: 2048,
      messages: [
        {
          role: 'user',
          content: buildRoadmapMessage({
            text: utterance,
            themes: world.themes,
            projects: world.projects,
            today,
            // Read per request rather than cached: the user can rewrite it
            // in settings between two roadmaps and expects the next one to
            // know.
            profile: readRapiProfile(),
            character: readRapiCharacter(),
            ...(isFinal ? { answers } : {}),
          }),
        },
      ],
    });
    raw = extractJson(response.content);
  } catch (err) {
    logger.info({ err }, 'roadmap drafting unavailable');
    return null;
  }
  if (!raw) return null;

  const deadlineInDays = asDayCount(raw.deadlineInDays);
  const steps = resolveSteps(raw.steps, {
    today,
    ...(deadlineInDays !== undefined ? { deadlineInDays } : {}),
  });
  // A plan with nothing to do is not a plan. Better to say nothing came back
  // than to show an empty roadmap as though it were an answer.
  if (steps.length === 0) return null;

  const goal = asText(raw.goal, MAX_TITLE) ?? utterance.slice(0, MAX_TITLE);
  const draft: RoadmapDraft = {
    goal,
    themeChoice: resolvePlacement(raw.themeChoice, world.themes, 'new'),
    projectChoice: resolvePlacement(raw.projectChoice, world.projects, 'none'),
    // Asking again once the answers are in is a loop with no exit, and the
    // screen has no second place to put the questions.
    questions: isFinal ? [] : resolveQuestions(raw.questions),
    steps,
    assumptions: resolveList(raw.assumptions, MAX_NOTE_ITEMS),
    comparisonAxes: resolveList(raw.comparisonAxes, MAX_NOTE_ITEMS),
    ...(deadlineInDays !== undefined ? { deadline: dayAfter(today, deadlineInDays) } : {}),
  };

  logger.info(
    {
      final: isFinal,
      steps: steps.length,
      questions: draft.questions.length,
      theme: draft.themeChoice.kind,
      deadline: draft.deadline ?? null,
    },
    'roadmap drafted',
  );
  return draft;
}
