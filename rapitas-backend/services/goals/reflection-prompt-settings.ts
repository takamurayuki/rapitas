/**
 * reflection-prompt-settings
 *
 * The weekly reflection nudge's day/time and its "last week sent" record, both
 * on the UserSettings row. Not responsible for deciding when to send (see
 * reflection-prompt.ts).
 *
 * NOTE: The three columns are new; a Prisma client generated before them does
 * not know the fields, so every access is guarded and falls back to the default
 * (Sunday 20:00) or fails closed (no claim) until the server restarts.
 */
import { createLogger } from '../../config/logger';
import {
  DEFAULT_PROMPT_SETTINGS,
  normalizePromptSettings,
  type PromptSettings,
  type WeekClaimStore,
} from './reflection-prompt';

const log = createLogger('services:goals:reflection-prompt-settings');

interface SettingsRow {
  id: number;
  reflectionPromptDow: number;
  reflectionPromptTime: string;
  reflectionPromptLastWeek: string | null;
}

/** The slice of Prisma these functions use. */
export interface SettingsDb {
  userSettings: {
    findFirst(args?: Record<string, unknown>): Promise<SettingsRow | null>;
    create(args: { data: Partial<Omit<SettingsRow, 'id'>> }): Promise<SettingsRow>;
    update(args: {
      where: { id: number };
      data: Partial<Omit<SettingsRow, 'id'>>;
    }): Promise<SettingsRow>;
    updateMany(args: {
      where: {
        reflectionPromptLastWeek: { not: string } | { equals: string | null };
      };
      data: { reflectionPromptLastWeek: string | null };
    }): Promise<{ count: number }>;
  };
}

/**
 * Read the nudge day and time; any failure or invalid value reads as the default.
 *
 * @param db - Prisma slice / DB
 * @returns Valid settings / 有効な設定
 */
export async function readPromptSettings(db: SettingsDb): Promise<PromptSettings> {
  try {
    const row = await db.userSettings.findFirst();
    if (!row) return { ...DEFAULT_PROMPT_SETTINGS };
    return normalizePromptSettings({
      dow: row.reflectionPromptDow,
      time: row.reflectionPromptTime,
    });
  } catch (err) {
    log.warn({ err }, 'reflection prompt settings unreadable; using the default');
    return { ...DEFAULT_PROMPT_SETTINGS };
  }
}

/**
 * Persist the nudge day and time. Invalid values are refused, not coerced.
 *
 * @param db - Prisma slice / DB
 * @param raw - Candidate settings / 保存したい設定
 * @returns The saved settings, or null when the input is invalid / 保存した設定、不正なら null
 * @throws When the database write fails / DB 書き込み失敗時
 */
export async function writePromptSettings(
  db: SettingsDb,
  raw: { dow: unknown; time: unknown },
): Promise<PromptSettings | null> {
  const normalized = normalizePromptSettings(raw);
  if (normalized.dow !== raw.dow || normalized.time !== raw.time) return null;
  const data = { reflectionPromptDow: normalized.dow, reflectionPromptTime: normalized.time };
  const row = await db.userSettings.findFirst();
  if (row) await db.userSettings.update({ where: { id: row.id }, data });
  else await db.userSettings.create({ data });
  return normalized;
}

/**
 * Claim and release the "nudge sent for this week" record with conditional
 * updates, so two ticks cannot both claim a week.
 *
 * @param db - Prisma slice / DB
 * @returns The claim store used by sendWeeklyReflectionPrompt / 週の確保ストア
 */
export function createWeekClaimStore(db: SettingsDb): WeekClaimStore {
  return {
    async claim(weekStart) {
      try {
        let row = await db.userSettings.findFirst();
        if (!row) row = await db.userSettings.create({ data: {} });
        const previous = row.reflectionPromptLastWeek;
        const { count } = await db.userSettings.updateMany({
          where: { reflectionPromptLastWeek: { not: weekStart } },
          data: { reflectionPromptLastWeek: weekStart },
        });
        // Rows with a NULL record do not match `not`, so claim those explicitly.
        if (count === 0 && previous === null) {
          const nulls = await db.userSettings.updateMany({
            where: { reflectionPromptLastWeek: { equals: null } },
            data: { reflectionPromptLastWeek: weekStart },
          });
          return { claimed: nulls.count > 0, previous };
        }
        return { claimed: count > 0, previous };
      } catch (err) {
        // Fail closed: an unreadable record must never allow a second send.
        log.warn({ err }, 'could not claim the reflection prompt week');
        return { claimed: false, previous: null };
      }
    },
    async release(weekStart, previous) {
      await db.userSettings.updateMany({
        where: { reflectionPromptLastWeek: { equals: weekStart } },
        data: { reflectionPromptLastWeek: previous },
      });
    },
  };
}
