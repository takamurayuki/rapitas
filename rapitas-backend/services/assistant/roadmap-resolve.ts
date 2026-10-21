/**
 * RoadmapResolve
 *
 * Not believing the model.
 *
 * Everything here exists because the draft is invented: a theme id that is
 * not there, a step with no title, a question with one option, a day count
 * that is a float. Each is turned into something harmless — a proposal to
 * create, a dropped row, an absent date — rather than passed on as though
 * it were a fact. An invented id taken at face value files work into
 * nothing; a bad date is worse, because it looks like a decision.
 *
 * Nothing here calls a model or a database, which is what makes it the part
 * that can be tested exhaustively.
 *
 * Not responsible for asking — see `roadmap-draft.ts`.
 */
import { MAX_ROADMAP_STEPS, MAX_ROADMAP_QUESTIONS, type NamedRef } from './roadmap-prompts';
import type { Placement, RoadmapQuestion, RoadmapStep } from './roadmap-types';

/** Keeps one chatty answer from filling the panel. */
export const MAX_TITLE = 120;
export const MAX_BODY = 1200;
export const MAX_OPTION = 80;

/** What the model returns, before any of it is believed. */
export interface RawDraft {
  goal?: unknown;
  themeChoice?: unknown;
  projectChoice?: unknown;
  questions?: unknown;
  steps?: unknown;
  deadlineInDays?: unknown;
  assumptions?: unknown;
  comparisonAxes?: unknown;
}

/** Ten years out. Past this a day count is a misread, not a plan. */
const MAX_DAYS_OUT = 3650;

/**
 * A whole number of days from today, or undefined.
 *
 * Counts rather than dates is the whole point: the model is asked "how many
 * days", because asked for a date it produces one that is plausible and
 * wrong, and nothing downstream can tell the difference.
 */
export function asDayCount(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
  if (value < 0 || value > MAX_DAYS_OUT) return undefined;
  return value;
}

/** That many days after today, as YYYY-MM-DD. */
export function dayAfter(today: Date, days: number): string {
  const when = new Date(today.getTime());
  when.setUTCDate(when.getUTCDate() + days);
  return when.toISOString().slice(0, 10);
}

/**
 * Compose a task description from what to do and what counts as done.
 *
 * Built here rather than on screen so the text the user approves is
 * character-for-character the text that becomes the task — the commit half
 * runs no model precisely so that nothing can change in between.
 *
 * @param action - The one thing to do / やること
 * @param done - What finished looks like / 完了条件
 * @returns The description, or empty when there is nothing to say / 説明文
 */
export function composeDescription(action: string, done: string[]): string {
  const parts: string[] = [];
  if (action.trim()) parts.push(action.trim());
  const conditions = done.map((d) => d.trim()).filter(Boolean);
  // No heading without conditions under it: an empty "完了条件" reads as
  // "there are none", which is not what a missing field means.
  if (conditions.length > 0) {
    parts.push(['## 完了条件', ...conditions.map((c) => `- [ ] ${c}`)].join('\n'));
  }
  return parts.join('\n\n');
}

/** Pull the first JSON object out of a reply that may be fenced or chatty. */
export function extractJson(text: string): RawDraft | null {
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
export function asText(value: unknown, max: number): string | undefined {
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
export function resolvePlacement(
  raw: unknown,
  known: NamedRef[],
  fallback: 'new' | 'none',
): Placement {
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

/**
 * Keep the steps that could actually become a task.
 *
 * @param raw - Whatever the model put in `steps` / モデルの出力
 * @param dates - Today, and the deadline in days when one was named / 起点日と期限
 * @returns The steps worth showing / 表示に足るステップ
 */
export function resolveSteps(
  raw: unknown,
  dates: { today: Date; deadlineInDays?: number },
): RoadmapStep[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => {
      const step = (s ?? {}) as {
        title?: unknown;
        description?: unknown;
        action?: unknown;
        done?: unknown;
        dueInDays?: unknown;
      };
      const title = asText(step.title, MAX_TITLE);
      if (!title) return null;

      const action = asText(step.action, MAX_BODY);
      const done = Array.isArray(step.done)
        ? step.done.map((d) => asText(d, MAX_OPTION)).filter((d): d is string => !!d)
        : [];
      // `description` is the older shape, still accepted: a model that
      // answers in it is not wrong, it is just less structured.
      const description = action
        ? composeDescription(action, done)
        : (asText(step.description, MAX_BODY) ?? '');

      const due = asDayCount(step.dueInDays);
      // Dates only mean something relative to a deadline. Without one the
      // numbers would be invented pressure.
      const dated =
        due !== undefined && dates.deadlineInDays !== undefined
          ? // A step due after the thing it is for has already happened is
            // not a plan: the step's date is what is wrong, not the deadline.
            dayAfter(dates.today, Math.min(due, dates.deadlineInDays))
          : undefined;

      return { title, description, ...(dated ? { dueDate: dated } : {}) };
    })
    .filter((s): s is RoadmapStep => s !== null)
    .slice(0, MAX_ROADMAP_STEPS);
}

/**
 * Keep the usable strings out of a list the model returned.
 *
 * @param raw - Whatever it put there / モデルの出力
 * @param max - How many to keep / 残す上限
 * @returns The non-empty entries, bounded / 空でない項目（上限まで）
 */
export function resolveList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => asText(item, MAX_OPTION))
    .filter((item): item is string => !!item)
    .slice(0, max);
}

/** Keep the questions that actually offer a choice. */
export function resolveQuestions(raw: unknown): RoadmapQuestion[] {
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
