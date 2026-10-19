/**
 * TaskDraft
 *
 * Turns something the user said to ラピ into a *proposed* task, for them to
 * look at and confirm.
 *
 * It is deliberately not responsible for creating anything. The existing
 * `/tasks/quick-create` pipeline parses the same kind of prose and then writes
 * immediately — a task, its subtasks and a rewritten description — with no
 * step in between where the user can see what it understood. ラピ needs the
 * other half: work out the fields, say why, and stop.
 *
 * Pure. No database, no clock of its own, no model call — so what it proposes
 * is reproducible and can be read back to the user as a reason rather than as
 * an opaque suggestion.
 */
import { parseNaturalLanguageTask } from '../ai/natural-language-parser';

/** The minimum a theme has to tell us to be matched and offered. */
export interface ThemeRef {
  id: number;
  name: string;
}

/** A field of the draft the user may have to decide for themselves. */
export type DraftField = 'title' | 'theme' | 'priority' | 'dueDate' | 'estimatedHours';

/**
 * Why a field looks the way it does.
 *
 * A code rather than a sentence: the explanation is shown in the UI, which is
 * translated, so a Japanese string baked in here would be wrong in English and
 * invisible to the catalogue.
 */
export interface DraftReason {
  code: 'matchedThemeName' | 'parsedFromText';
  value?: string;
}

/**
 * A proposed task. Carries no id, because nothing has been created.
 */
export interface TaskDraft {
  title: string;
  /** The original utterance, kept whenever the title is a shortened form of it. */
  description?: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  /** ISO string, as produced by the natural-language parser. */
  dueDate?: string;
  estimatedHours?: number;
  /** Set only when exactly one theme could be identified. */
  themeId?: number;
  /** What to offer the user: the matches when there were several, else everything. */
  themeCandidates: ThemeRef[];
  /** Fields that still need the user before this can be filed. */
  missing: DraftField[];
  reasons: Partial<Record<DraftField, DraftReason>>;
}

/**
 * Find the themes whose name occurs in the text.
 *
 * Substring rather than word-boundary matching, because Japanese is not
 * delimited by spaces and a theme called 健康 has to be found inside 健康診断.
 *
 * @param text - What the user said / ユーザーの発話
 * @param themes - Every theme that could be meant / 候補となる全テーマ
 * @returns The themes named in the text / 発話中に現れたテーマ
 */
function themesNamedIn(text: string, themes: ThemeRef[]): ThemeRef[] {
  const haystack = text.toLowerCase();
  return themes.filter((theme) => {
    const name = theme.name.trim().toLowerCase();
    // A one-character name matches almost anything; offer it, never preselect it.
    return name.length >= 2 && haystack.includes(name);
  });
}

/**
 * Propose a task from free text, without creating anything.
 *
 * @param text - What the user said / ユーザーの発話
 * @param themes - Every theme the task could belong to / 割当候補の全テーマ
 * @returns The proposed task, with what it could not determine / 提案内容と未確定項目
 */
export function buildTaskDraft(text: string, themes: ThemeRef[]): TaskDraft {
  const utterance = text.trim();
  const parsed = parseNaturalLanguageTask(utterance);
  const title = parsed.title.trim();

  const missing: DraftField[] = [];
  const reasons: Partial<Record<DraftField, DraftReason>> = {};

  if (!title) missing.push('title');

  const matched = themesNamedIn(utterance, themes);
  let themeId: number | undefined;
  let themeCandidates: ThemeRef[];
  if (matched.length === 1) {
    themeId = matched[0].id;
    themeCandidates = matched;
    reasons.theme = { code: 'matchedThemeName', value: matched[0].name };
  } else {
    // Ambiguous or absent. A task always belongs to a theme, so this is never
    // something to guess at — offer the narrowest honest set and ask.
    themeCandidates = matched.length > 1 ? matched : themes;
    missing.push('theme');
  }

  if (parsed.priority) reasons.priority = { code: 'parsedFromText' };
  if (parsed.dueDate) reasons.dueDate = { code: 'parsedFromText' };
  if (parsed.estimatedHours) reasons.estimatedHours = { code: 'parsedFromText' };

  return {
    title,
    // The parser strips the phrases it recognised, so the title is usually a
    // shortened form. Keeping the original means the context the user gave is
    // not silently dropped on the floor.
    ...(utterance && utterance !== title ? { description: utterance } : {}),
    ...(parsed.priority ? { priority: parsed.priority } : {}),
    ...(parsed.dueDate ? { dueDate: parsed.dueDate } : {}),
    ...(parsed.estimatedHours ? { estimatedHours: parsed.estimatedHours } : {}),
    ...(themeId !== undefined ? { themeId } : {}),
    themeCandidates,
    missing,
    reasons,
  };
}
