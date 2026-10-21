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
 * Everything asked in one round rather than a conversation: ラピ has no
 * memory between messages, and the questions follow the house rules the
 * workflow already uses — two to four choices, with a recommendation and a
 * reason for it, because a choice offered without one hands the decision
 * back without helping make it.
 *
 * Not responsible for creating anything — see the commit half.
 */
import { sendAIMessage } from '../../utils/ai-client';
import { createLogger } from '../../config/logger';

const logger = createLogger('assistant-roadmap');

/** Most steps one draft may propose. A roadmap is not a backlog dump. */
export const MAX_ROADMAP_STEPS = 12;

/** Most questions one round may ask. Beyond this it is an interview. */
export const MAX_ROADMAP_QUESTIONS = 4;

/** Keeps one chatty answer from filling the panel. */
const MAX_TITLE = 120;
const MAX_BODY = 1200;
const MAX_OPTION = 80;

/** A theme or project the model is shown. */
export interface NamedRef {
  id: number;
  name: string;
  description?: string | null;
}

/** Where the work should go, once the invented ids are stripped out. */
export type Placement =
  | { kind: 'existing'; id: number; name: string }
  | { kind: 'new'; name: string; reason: string }
  | { kind: 'none'; reason: string };

export interface RoadmapStep {
  title: string;
  /** What "done" means, in numbers where numbers apply. */
  description: string;
}

export interface RoadmapQuestion {
  question: string;
  options: string[];
  recommended?: string;
  recommendedReason?: string;
}

export interface RoadmapDraft {
  /** The goal as she understood it, so a misreading shows before any work. */
  goal: string;
  themeChoice: Placement;
  projectChoice: Placement;
  questions: RoadmapQuestion[];
  steps: RoadmapStep[];
}

const SYSTEM_PROMPT = `あなたは rapitas というタスク管理アプリのアシスタント「ラピ」です。
ユーザーがやりたいことを聞いて、計画を立てます。**作成はしません**。提案するだけで、実際の作成は本人の承認後に別途行われます。

出すもの:
1. goal: ユーザーのやりたいことを1文で言い直す。読み違えていたらここで分かるように。
2. themeChoice: 作業を置くテーマ。既存に合うものがあれば existing、無ければ new。無理に既存へ当てはめない。
3. projectChoice: まとまりとしてのプロジェクト。既存・新規・不要(none)のいずれか。テーマとは独立した別の分類で、階層ではない。
4. questions: 計画を確定するために本人に聞くべきこと。1往復で済ませるため、必要なことは全部ここで聞く。
5. steps: 実行可能な粒度に割ったタスク。各ステップの description には「何をどこまでやれば完了か」を定量的に書く（件数・対象ファイル数・満たすべき条件など）。

質問の作り方:
- options は2〜4個。自由記述にしない。
- recommended にはどれを勧めるか、recommendedReason にはその理由を1文で書く。
- 聞くことが無ければ questions は空配列でよい。

守ること:
1. 出力は JSON オブジェクトのみ。前後に説明文を付けない。
2. テーマ・プロジェクトの id は提示された一覧のものだけを使う。無ければ new または none にする。
3. steps は多くても ${MAX_ROADMAP_STEPS} 個。1つで終わるならそれでよい。

JSON の形:
{
  "goal": string,
  "themeChoice": { "kind": "existing", "id": number } | { "kind": "new", "name": string, "reason": string },
  "projectChoice": { "kind": "existing", "id": number } | { "kind": "new", "name": string, "reason": string } | { "kind": "none", "reason": string },
  "questions": [{ "question": string, "options": string[], "recommended": string, "recommendedReason": string }],
  "steps": [{ "title": string, "description": string }]
}`;

/** What the model returns, before any of it is believed. */
interface RawDraft {
  goal?: unknown;
  themeChoice?: unknown;
  projectChoice?: unknown;
  questions?: unknown;
  steps?: unknown;
}

/** Pull the first JSON object out of a reply that may be fenced or chatty. */
function extractJson(text: string): RawDraft | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as RawDraft;
  } catch {
    return null;
  }
}

/** A non-empty trimmed string, or undefined. */
function asText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : undefined;
}

/**
 * Resolve a proposed placement against what actually exists.
 *
 * An id the model invented is the dangerous case: taken at face value it
 * files the work into something that is not there. It becomes a proposal to
 * create instead, which the user can see and refuse.
 */
function resolvePlacement(raw: unknown, known: NamedRef[], fallback: 'new' | 'none'): Placement {
  const choice = (raw ?? {}) as { kind?: unknown; id?: unknown; name?: unknown; reason?: unknown };
  const reason = asText(choice.reason, MAX_BODY) ?? '';

  if (choice.kind === 'existing' && typeof choice.id === 'number') {
    const found = known.find((k) => k.id === choice.id);
    if (found) return { kind: 'existing', id: found.id, name: found.name };
    // Invented. Fall through to proposing something rather than pointing at
    // an id that is not there.
  }

  if (choice.kind === 'none') return { kind: 'none', reason };

  const name = asText(choice.name, MAX_TITLE);
  if (name) return { kind: 'new', name, reason };

  return fallback === 'none' ? { kind: 'none', reason } : { kind: 'new', name: '', reason };
}

/** Keep the steps that could actually become a task. */
function resolveSteps(raw: unknown): RoadmapStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      const step = (s ?? {}) as { title?: unknown; description?: unknown };
      const title = asText(step.title, MAX_TITLE);
      if (!title) return null;
      return { title, description: asText(step.description, MAX_BODY) ?? '' };
    })
    .filter((s): s is RoadmapStep => s !== null)
    .slice(0, MAX_ROADMAP_STEPS);
}

/** Keep the questions that actually offer a choice. */
function resolveQuestions(raw: unknown): RoadmapQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q) => {
      const item = (q ?? {}) as {
        question?: unknown;
        options?: unknown;
        recommended?: unknown;
        recommendedReason?: unknown;
      };
      const question = asText(item.question, MAX_TITLE);
      const options = Array.isArray(item.options)
        ? item.options.map((o) => asText(o, MAX_OPTION)).filter((o): o is string => !!o)
        : [];
      // One option is not a choice, and none is a free-text box the house
      // rules rule out.
      if (!question || options.length < 2) return null;
      return {
        question,
        options: options.slice(0, 4),
        ...(asText(item.recommended, MAX_OPTION)
          ? { recommended: asText(item.recommended, MAX_OPTION) }
          : {}),
        ...(asText(item.recommendedReason, MAX_BODY)
          ? { recommendedReason: asText(item.recommendedReason, MAX_BODY) }
          : {}),
      };
    })
    .filter((q): q is RoadmapQuestion => q !== null)
    .slice(0, MAX_ROADMAP_QUESTIONS);
}

/**
 * Draft a plan for something the user wants to do.
 *
 * @param text - What they said they want / やりたいこと
 * @param world - The themes and projects that already exist / 既存のテーマとプロジェクト
 * @returns The plan, or null when nothing usable came back / 計画（作れなければ null）
 */
export async function draftRoadmap(
  text: string,
  world: { themes: NamedRef[]; projects: NamedRef[] },
): Promise<RoadmapDraft | null> {
  const utterance = text.trim();
  if (!utterance) return null;

  const list = (items: NamedRef[]) =>
    items.length > 0
      ? items
          .map((i) => `- id=${i.id} 「${i.name}」${i.description ? ` — ${i.description}` : ''}`)
          .join('\n')
      : '（まだありません）';

  let raw: RawDraft | null = null;
  try {
    const response = await sendAIMessage({
      provider: 'ollama',
      systemPrompt: SYSTEM_PROMPT,
      maxTokens: 2048,
      messages: [
        {
          role: 'user',
          content: `既存のテーマ:\n${list(world.themes)}\n\n既存のプロジェクト:\n${list(world.projects)}\n\nやりたいこと:\n${utterance}`,
        },
      ],
    });
    raw = extractJson(response.content);
  } catch (err) {
    logger.info({ err }, 'roadmap drafting unavailable');
    return null;
  }
  if (!raw) return null;

  const steps = resolveSteps(raw.steps);
  // A plan with nothing to do is not a plan. Better to say nothing came back
  // than to show an empty roadmap as though it were an answer.
  if (steps.length === 0) return null;

  const goal = asText(raw.goal, MAX_TITLE) ?? utterance.slice(0, MAX_TITLE);
  const draft: RoadmapDraft = {
    goal,
    themeChoice: resolvePlacement(raw.themeChoice, world.themes, 'new'),
    projectChoice: resolvePlacement(raw.projectChoice, world.projects, 'none'),
    questions: resolveQuestions(raw.questions),
    steps,
  };

  logger.info(
    { steps: steps.length, questions: draft.questions.length, theme: draft.themeChoice.kind },
    'roadmap drafted',
  );
  return draft;
}
