/**
 * goal-reflection-week
 *
 * The week key of a 前進の振り返り: the Monday (Asia/Tokyo) as YYYY-MM-DD.
 * Mirrors getWeekStart in rapitas-backend/services/goals/goal-reflection.ts so
 * the modal can find this week's saved record; the server remains the authority.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Longest note the server accepts, in code points. */
export const REFLECTION_NOTE_MAX = 500;

/**
 * The Monday (Asia/Tokyo) of the week containing `date`.
 *
 * @param date - Any instant / 任意の時刻
 * @returns `YYYY-MM-DD` / 週キー
 */
export function currentWeekStart(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS);
  const sinceMonday = (jst.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - sinceMonday * DAY_MS,
  );
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/**
 * Number of characters as the server counts them (code points, not UTF-16 units).
 *
 * @param text - The note / 一言
 * @returns Code point count / 文字数
 */
export function noteLength(text: string): number {
  return Array.from(text).length;
}
