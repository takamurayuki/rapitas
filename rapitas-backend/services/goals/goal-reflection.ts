/**
 * goal-reflection
 *
 * The weekly 前進の振り返り: one 1-5 rating and an optional note per goal per
 * week. Owns validation, the week key and the save/list rules; not responsible
 * for HTTP or for prompting the person (see reflection-prompt.ts).
 */

/** Longest note accepted, counted in code points. */
export const REFLECTION_NOTE_MAX = 500;

/** Offset of Asia/Tokyo from UTC; Japan has no daylight saving time. */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ReflectionRefusal =
  | 'reflection_rating_invalid'
  | 'reflection_note_invalid'
  | 'reflection_note_too_long'
  | 'reflection_week_invalid'
  | 'reflection_goal_not_found';

/** One stored reflection row. */
export interface ReflectionRow {
  projectId: number;
  weekStart: string;
  rating: number;
  note: string | null;
  updatedAt: Date;
}

/** One point of a goal's trend, as the API returns it. */
export interface ReflectionItem {
  projectId: number;
  weekStart: string;
  rating: number;
  note: string | null;
  updatedAt: Date;
}

/** The slice of Prisma these functions use, so tests need no database. */
export interface ReflectionDb {
  project: { findUnique(args: { where: { id: number } }): Promise<{ id: number } | null> };
  /** Optional: when present, saving closes this week's nudge by marking it read. */
  notification?: {
    updateMany(args: {
      where: { type: string; metadata: { contains: string } };
      data: { isRead: boolean; readAt: Date };
    }): Promise<unknown>;
  };
  goalReflection: {
    upsert(args: {
      where: { projectId_weekStart: { projectId: number; weekStart: string } };
      create: { projectId: number; weekStart: string; rating: number; note: string | null };
      update: { rating: number; note: string | null };
    }): Promise<ReflectionRow>;
    findMany(args: {
      where: { projectId: number };
      orderBy: { weekStart: 'asc' };
    }): Promise<ReflectionRow[]>;
  };
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDay(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * The Monday (Asia/Tokyo) of the week containing `date`, as YYYY-MM-DD.
 * Every place that keys a reflection or a prompt by week must use this.
 *
 * @param date - Any instant / 任意の時刻
 * @returns Week key `YYYY-MM-DD` / 週キー
 */
export function getWeekStart(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  const sinceMonday = (jst.getUTCDay() + 6) % 7;
  const mondayUtcMidnight =
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - sinceMonday * DAY_MS;
  return formatDay(mondayUtcMidnight);
}

/** True for a real calendar date that falls on a Monday. */
function isMondayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms) || formatDay(ms) !== value) return false;
  return new Date(ms).getUTCDay() === 1;
}

export type ValidatedReflection =
  | { ok: true; rating: number; note: string | null }
  | { ok: false; code: ReflectionRefusal };

/**
 * Check a rating and note. Rating must be an integer 1-5; the note is
 * optional, trimmed, and at most 500 code points (so an emoji counts once).
 *
 * @param input - Raw values from the request / リクエストの生の値
 * @returns The cleaned values, or the reason for refusing / 検証済み値または拒否理由
 */
export function validateReflectionInput(input: {
  rating: unknown;
  note?: unknown;
}): ValidatedReflection {
  const { rating, note } = input;
  if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, code: 'reflection_rating_invalid' };
  }
  if (note === undefined || note === null) return { ok: true, rating, note: null };
  if (typeof note !== 'string') return { ok: false, code: 'reflection_note_invalid' };
  // NOTE: Length is judged on the text as sent, before trimming, so 500 characters plus
  // trailing whitespace is refused the same way the screen's counter shows it.
  if (Array.from(note).length > REFLECTION_NOTE_MAX) {
    return { ok: false, code: 'reflection_note_too_long' };
  }
  const trimmed = note.trim();
  return { ok: true, rating, note: trimmed === '' ? null : trimmed };
}

export type SaveReflectionResult =
  | { ok: true; item: ReflectionItem }
  | { ok: false; code: ReflectionRefusal };

/**
 * Save the goal's reflection for a week; a second save for the same goal and
 * week updates the existing row (the unique key makes it one per week).
 *
 * @param db - Prisma slice / DB
 * @param input - Goal, rating, note, optional week to edit, and the current time / 入力
 * @returns The stored item, or the refusal / 保存結果
 */
export async function saveReflection(
  db: ReflectionDb,
  input: { projectId: number; rating: unknown; note?: unknown; weekStart?: string; now: Date },
): Promise<SaveReflectionResult> {
  const checked = validateReflectionInput(input);
  if (!checked.ok) return checked;

  const currentWeek = getWeekStart(input.now);
  const weekStart = input.weekStart ?? currentWeek;
  // A past week may be corrected; a week that has not started cannot be reflected on yet.
  if (!isMondayKey(weekStart) || weekStart > currentWeek) {
    return { ok: false, code: 'reflection_week_invalid' };
  }

  const project = await db.project.findUnique({ where: { id: input.projectId } });
  if (!project) return { ok: false, code: 'reflection_goal_not_found' };

  const row = await db.goalReflection.upsert({
    where: { projectId_weekStart: { projectId: input.projectId, weekStart } },
    create: { projectId: input.projectId, weekStart, rating: checked.rating, note: checked.note },
    update: { rating: checked.rating, note: checked.note },
  });
  // Best effort: a failure here must not lose the saved reflection, and the nudge is
  // never re-sent for a week that has a reflection anyway (see reflection-prompt.ts).
  await db.notification
    ?.updateMany({
      where: {
        type: 'goal_reflection_prompt',
        metadata: { contains: `"weekStart":"${weekStart}"` },
      },
      data: { isRead: true, readAt: input.now },
    })
    .catch(() => undefined);
  return { ok: true, item: toItem(row) };
}

function toItem(row: ReflectionRow): ReflectionItem {
  return {
    projectId: row.projectId,
    weekStart: row.weekStart,
    rating: row.rating,
    note: row.note,
    updatedAt: row.updatedAt,
  };
}

/**
 * A goal's reflections, one per week, oldest first (the trend the metrics page reads).
 *
 * @param db - Prisma slice / DB
 * @param projectId - Goal id / ゴールID
 * @returns The items, or a refusal when the goal does not exist / 推移または拒否
 */
export async function listReflections(
  db: ReflectionDb,
  projectId: number,
): Promise<{ ok: true; items: ReflectionItem[] } | { ok: false; code: ReflectionRefusal }> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  if (!project) return { ok: false, code: 'reflection_goal_not_found' };
  const rows = await db.goalReflection.findMany({
    where: { projectId },
    orderBy: { weekStart: 'asc' },
  });
  return { ok: true, items: rows.map(toItem) };
}
