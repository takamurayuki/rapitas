/**
 * reflection-prompt
 *
 * The weekly nudge to write the 前進の振り返り: one Notification per week
 * listing the goals that still have none. Whether a nudge was already sent is
 * read from the stored Notification (metadata.weekStart), so a restart or a
 * missed minute neither loses it nor sends it twice, and a dismissed (read)
 * nudge stays quiet until the next week. Not responsible for saving
 * reflections (see goal-reflection.ts).
 */
import { buildNotificationI18n } from '../communication/notification-i18n';
import { createLogger } from '../../config/logger';
import { getWeekStart } from './goal-reflection';

const log = createLogger('services:goals:reflection-prompt');

/** Notification type of the weekly nudge. */
export const REFLECTION_PROMPT_TYPE = 'goal_reflection_prompt';

/** When in the week (Asia/Tokyo) the nudge becomes due. */
export interface PromptSettings {
  /** 0 = Sunday .. 6 = Saturday. */
  dow: number;
  /** "HH:MM", 24-hour. */
  time: string;
}

/** Sunday 20:00. */
export const DEFAULT_PROMPT_SETTINGS: PromptSettings = { dow: 0, time: '20:00' };

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Coerce stored settings to valid ones; an invalid half falls back to its
 * default so a damaged file cannot silence the nudge.
 *
 * @param raw - Whatever was read from storage / 保存値
 * @returns Valid settings / 有効な設定
 */
export function normalizePromptSettings(raw: unknown): PromptSettings {
  const r = (raw ?? {}) as { dow?: unknown; time?: unknown };
  const dow =
    typeof r.dow === 'number' && Number.isInteger(r.dow) && r.dow >= 0 && r.dow <= 6
      ? r.dow
      : DEFAULT_PROMPT_SETTINGS.dow;
  const time =
    typeof r.time === 'string' && TIME_RE.test(r.time) ? r.time : DEFAULT_PROMPT_SETTINGS.time;
  return { dow, time };
}

/**
 * Whether the configured moment of the current week (Monday-start, Asia/Tokyo)
 * has passed. Stays true until the week ends, so a missed tick catches up.
 *
 * @param now - Current time / 現在時刻
 * @param settings - Day and time / 曜日と時刻
 * @returns True once the moment has passed this week / 時刻を過ぎていれば true
 */
export function isPromptDue(now: Date, settings: PromptSettings): boolean {
  const match = TIME_RE.exec(settings.time);
  if (!match) return false;
  const mondayUtcMidnight = Date.parse(`${getWeekStart(now)}T00:00:00Z`);
  const daysFromMonday = (settings.dow + 6) % 7;
  const momentUtc =
    mondayUtcMidnight +
    daysFromMonday * DAY_MS +
    (Number(match[1]) * 60 + Number(match[2])) * 60_000 -
    JST_OFFSET_MS;
  return now.getTime() >= momentUtc;
}

/** The slice of Prisma the nudge uses. */
export interface PromptDb {
  project: {
    findMany(args: {
      where: { milestones: { some: { status: string } } };
      select: { id: true };
    }): Promise<{ id: number }[]>;
  };
  goalReflection: {
    findMany(args: {
      where: { weekStart: string };
      select: { projectId: true };
    }): Promise<{ projectId: number }[]>;
  };
  notification: {
    findFirst(args: {
      where: { type: string; metadata: { contains: string } };
    }): Promise<unknown | null>;
    create(args: {
      data: { type: string; title: string; message: string; link: string; metadata: string };
    }): Promise<unknown>;
  };
}

/**
 * Durable, exclusive record of the last week a nudge was claimed, kept apart
 * from the notification row so deleting the notification cannot bring it back.
 */
export interface WeekClaimStore {
  /** Take the week; `claimed` is false when it was already taken. */
  claim(weekStart: string): Promise<{ claimed: boolean; previous: string | null }>;
  /** Give the week back (only while it is still the stored value). */
  release(weekStart: string, previous: string | null): Promise<void>;
}

const NO_CLAIM_STORE: WeekClaimStore = {
  claim: async () => ({ claimed: true, previous: null }),
  release: async () => undefined,
};

export type PromptResult =
  | { sent: true }
  | {
      sent: false;
      reason: 'not_due' | 'already_sent' | 'no_goals' | 'already_reflected' | 'notification_failed';
    };

/**
 * Send this week's nudge if it is due and nobody has been nudged yet.
 * Safe to call on every scheduler tick.
 *
 * @param db - Prisma slice / DB
 * @param now - Current time / 現在時刻
 * @param settings - Day and time the nudge becomes due / 曜日と時刻
 * @returns Whether a notification was created, and why not / 送出結果
 */
export async function sendWeeklyReflectionPrompt(
  db: PromptDb,
  now: Date,
  settings: PromptSettings,
  claims: WeekClaimStore = NO_CLAIM_STORE,
): Promise<PromptResult> {
  if (!isPromptDue(now, settings)) return { sent: false, reason: 'not_due' };

  const weekStart = getWeekStart(now);
  // Existence, not read state: dismissing the nudge must not bring it back this week.
  const existing = await db.notification.findFirst({
    where: { type: REFLECTION_PROMPT_TYPE, metadata: { contains: `"weekStart":"${weekStart}"` } },
  });
  if (existing) return { sent: false, reason: 'already_sent' };

  const goals = await db.project.findMany({
    where: { milestones: { some: { status: 'open' } } },
    select: { id: true },
  });
  if (goals.length === 0) return { sent: false, reason: 'no_goals' };

  // 進行中のゴールだけを照合し、今週分が未記録のゴールを促す。
  const done = new Set(
    (await db.goalReflection.findMany({ where: { weekStart }, select: { projectId: true } })).map(
      (r) => r.projectId,
    ),
  );
  const projectIds = goals.filter((g) => !done.has(g.id)).map((g) => g.id);
  if (projectIds.length === 0) return { sent: false, reason: 'already_reflected' };

  // The claim is taken BEFORE the notification so two ticks cannot both send, and it outlives
  // the notification: deleting the bell entry must not bring the nudge back this week.
  const claim = await claims.claim(weekStart);
  if (!claim.claimed) return { sent: false, reason: 'already_sent' };

  try {
    await db.notification.create({
      data: {
        type: REFLECTION_PROMPT_TYPE,
        title: '今週の前進を振り返りませんか',
        message: `進行中のゴール ${projectIds.length} 件について、1〜5 の評価と一言を残せます（1分ほどです）。`,
        link: '/goals',
        metadata: JSON.stringify({
          weekStart,
          projectIds,
          i18n: buildNotificationI18n(REFLECTION_PROMPT_TYPE, { count: projectIds.length }),
        }),
      },
    });
  } catch (err) {
    log.warn({ err, weekStart }, 'reflection prompt notification failed; releasing the week');
    // Give the week back so the next tick can retry; a failed release is logged, not swallowed.
    await claims.release(weekStart, claim.previous).catch((releaseErr: unknown) => {
      log.warn({ err: releaseErr, weekStart }, 'could not release the reflection prompt week');
    });
    return { sent: false, reason: 'notification_failed' };
  }
  return { sent: true };
}
