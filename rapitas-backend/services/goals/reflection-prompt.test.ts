/**
 * reflection-prompt.test
 *
 * The weekly nudge: at most one notification per week, nothing before the
 * configured day/time, nothing once the person saved a reflection for every
 * open goal, and a dismissed (read) nudge is not sent again that week.
 */
import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_PROMPT_SETTINGS,
  isPromptDue,
  normalizePromptSettings,
  sendWeeklyReflectionPrompt,
  type PromptDb,
  type WeekClaimStore,
} from './reflection-prompt';

interface FakeNotification {
  type: string;
  metadata: string;
  isRead: boolean;
}

/** In-memory claim store with the same exclusive semantics as the UserSettings one. */
function fakeClaims(opts: { failRelease?: boolean } = {}) {
  const state: { week: string | null; claims: number; releases: number } = {
    week: null,
    claims: 0,
    releases: 0,
  };
  const store: WeekClaimStore = {
    claim: async (weekStart) => {
      const previous = state.week;
      if (previous === weekStart) return { claimed: false, previous };
      state.week = weekStart;
      state.claims++;
      return { claimed: true, previous };
    },
    release: async (weekStart, previous) => {
      state.releases++;
      if (opts.failRelease) throw new Error('release failed');
      if (state.week === weekStart) state.week = previous;
    },
  };
  return { store, state };
}

function fakeDb(
  opts: { goals?: number[]; reflected?: Record<string, number[]>; failCreate?: boolean } = {},
) {
  const notifications: FakeNotification[] = [];
  const goals = opts.goals ?? [1, 2];
  const db: PromptDb = {
    project: { findMany: async () => goals.map((id) => ({ id })) },
    goalReflection: {
      findMany: async ({ where }) =>
        (opts.reflected?.[where.weekStart] ?? []).map((projectId) => ({ projectId })),
    },
    notification: {
      findFirst: async ({ where }) =>
        notifications.find(
          (n) => n.type === where.type && n.metadata.includes(where.metadata.contains),
        ) ?? null,
      create: async ({ data }) => {
        if (opts.failCreate) throw new Error('create failed');
        notifications.push({ type: data.type, metadata: data.metadata, isRead: false });
        return data;
      },
    },
  };
  return { db, notifications };
}

// 2026-11-29 is a Sunday. 20:00 JST = 11:00 UTC.
const SUN_2000 = new Date('2026-11-29T11:00:00Z');
const SUN_1959 = new Date('2026-11-29T10:59:00Z');

describe('normalizePromptSettings', () => {
  test('defaults to Sunday 20:00', () => {
    expect(DEFAULT_PROMPT_SETTINGS).toEqual({ dow: 0, time: '20:00' });
    expect(normalizePromptSettings(undefined)).toEqual({ dow: 0, time: '20:00' });
  });

  test('keeps valid values and falls back to the default for invalid ones', () => {
    expect(normalizePromptSettings({ dow: 3, time: '07:30' })).toEqual({ dow: 3, time: '07:30' });
    expect(normalizePromptSettings({ dow: 7, time: '25:00' })).toEqual({ dow: 0, time: '20:00' });
    expect(normalizePromptSettings({ dow: 1.5, time: 'abc' })).toEqual({ dow: 0, time: '20:00' });
  });
});

describe('isPromptDue', () => {
  test('not before the configured moment, due from it until the week ends', () => {
    expect(isPromptDue(SUN_1959, DEFAULT_PROMPT_SETTINGS)).toBe(false);
    expect(isPromptDue(SUN_2000, DEFAULT_PROMPT_SETTINGS)).toBe(true);
    expect(isPromptDue(new Date('2026-11-29T14:59:00Z'), DEFAULT_PROMPT_SETTINGS)).toBe(true); // Sun 23:59 JST
  });

  test('is not due earlier in the same week (Wednesday)', () => {
    expect(isPromptDue(new Date('2026-11-25T11:00:00Z'), DEFAULT_PROMPT_SETTINGS)).toBe(false);
  });

  test('a changed day and time moves the moment', () => {
    const wed0700 = { dow: 3, time: '07:00' };
    // Wed 07:00 JST = Tue 22:00 UTC
    expect(isPromptDue(new Date('2026-11-24T21:59:00Z'), wed0700)).toBe(false);
    expect(isPromptDue(new Date('2026-11-24T22:00:00Z'), wed0700)).toBe(true);
  });

  test('catches up after a restart: due again the next day if still unsent', () => {
    expect(isPromptDue(new Date('2026-11-29T14:00:00Z'), DEFAULT_PROMPT_SETTINGS)).toBe(true);
  });
});

describe('sendWeeklyReflectionPrompt', () => {
  test('sends one notification listing the open goals', async () => {
    const { db, notifications } = fakeDb();
    const result = await sendWeeklyReflectionPrompt(db, SUN_2000, DEFAULT_PROMPT_SETTINGS);
    expect(result).toEqual({ sent: true });
    expect(notifications).toHaveLength(1);
    const meta = JSON.parse(notifications[0].metadata);
    expect(notifications[0].type).toBe('goal_reflection_prompt');
    expect(meta.weekStart).toBe('2026-11-23');
    expect(meta.projectIds).toEqual([1, 2]);
    expect(meta.i18n.key).toBe('notification.types.goal_reflection_prompt.title');
  });

  test('a second tick in the same week sends nothing, even after the nudge was read', async () => {
    const { db, notifications } = fakeDb();
    await sendWeeklyReflectionPrompt(db, SUN_2000, DEFAULT_PROMPT_SETTINGS);
    notifications[0].isRead = true;
    const again = await sendWeeklyReflectionPrompt(
      db,
      new Date('2026-11-29T12:00:00Z'),
      DEFAULT_PROMPT_SETTINGS,
    );
    expect(again).toEqual({ sent: false, reason: 'already_sent' });
    expect(notifications).toHaveLength(1);
  });

  test('the next week sends again', async () => {
    const { db, notifications } = fakeDb();
    await sendWeeklyReflectionPrompt(db, SUN_2000, DEFAULT_PROMPT_SETTINGS);
    const next = await sendWeeklyReflectionPrompt(
      db,
      new Date('2026-12-06T11:00:00Z'),
      DEFAULT_PROMPT_SETTINGS,
    );
    expect(next).toEqual({ sent: true });
    expect(notifications).toHaveLength(2);
    expect(JSON.parse(notifications[1].metadata).weekStart).toBe('2026-11-30');
  });

  test('sends nothing before the configured time', async () => {
    const { db, notifications } = fakeDb();
    expect(await sendWeeklyReflectionPrompt(db, SUN_1959, DEFAULT_PROMPT_SETTINGS)).toEqual({
      sent: false,
      reason: 'not_due',
    });
    expect(notifications).toHaveLength(0);
  });

  test('sends nothing when no goal has an open milestone', async () => {
    const { db, notifications } = fakeDb({ goals: [] });
    expect(await sendWeeklyReflectionPrompt(db, SUN_2000, DEFAULT_PROMPT_SETTINGS)).toEqual({
      sent: false,
      reason: 'no_goals',
    });
    expect(notifications).toHaveLength(0);
  });

  test('進行中の全ゴールが今週分を保存済みなら促さない', async () => {
    for (const reflected of [
      [1, 2],
      [1, 2, 99],
    ]) {
      const { db, notifications } = fakeDb({ reflected: { '2026-11-23': reflected } });
      expect(await sendWeeklyReflectionPrompt(db, SUN_2000, DEFAULT_PROMPT_SETTINGS)).toEqual({
        sent: false,
        reason: 'already_reflected',
      });
      expect(notifications).toHaveLength(0);
    }
  });

  test.each([{ reflected: [99] }, { reflected: [1] }, { reflected: [1, 99] }])(
    '記録済みゴールが %j でも未記録の進行中ゴールを促す',
    async ({ reflected }) => {
      const { db, notifications } = fakeDb({ reflected: { '2026-11-23': reflected } });
      const { store, state } = fakeClaims();
      expect(
        await sendWeeklyReflectionPrompt(db, SUN_2000, DEFAULT_PROMPT_SETTINGS, store),
      ).toEqual({
        sent: true,
      });
      expect(notifications).toHaveLength(1);
      const remaining = [1, 2].filter((id) => !reflected.includes(id));
      const metadata = JSON.parse(notifications[0].metadata);
      expect(metadata.projectIds).toEqual(remaining);
      expect(metadata.i18n.params.count).toBe(remaining.length);
      expect(state.claims).toBe(1);
    },
  );

  test('deleting the notification does not bring the nudge back the same week', async () => {
    const { db, notifications } = fakeDb();
    const { store } = fakeClaims();
    expect(await sendWeeklyReflectionPrompt(db, SUN_2000, DEFAULT_PROMPT_SETTINGS, store)).toEqual({
      sent: true,
    });
    notifications.length = 0; // the bell's X deletes the row
    expect(
      await sendWeeklyReflectionPrompt(
        db,
        new Date('2026-11-29T12:00:00Z'),
        DEFAULT_PROMPT_SETTINGS,
        store,
      ),
    ).toEqual({ sent: false, reason: 'already_sent' });
    expect(notifications).toHaveLength(0);
    // next week it fires again
    expect(
      await sendWeeklyReflectionPrompt(
        db,
        new Date('2026-12-06T11:00:00Z'),
        DEFAULT_PROMPT_SETTINGS,
        store,
      ),
    ).toEqual({ sent: true });
  });

  test('a claim lost to another tick creates no notification', async () => {
    const { db, notifications } = fakeDb();
    const { store, state } = fakeClaims();
    state.week = '2026-11-23'; // another tick already took the week
    expect(await sendWeeklyReflectionPrompt(db, SUN_2000, DEFAULT_PROMPT_SETTINGS, store)).toEqual({
      sent: false,
      reason: 'already_sent',
    });
    expect(notifications).toHaveLength(0);
  });

  test('a failed notification gives the week back, so the next tick retries', async () => {
    const failing = fakeDb({ failCreate: true });
    const { store, state } = fakeClaims();
    expect(
      await sendWeeklyReflectionPrompt(failing.db, SUN_2000, DEFAULT_PROMPT_SETTINGS, store),
    ).toEqual({ sent: false, reason: 'notification_failed' });
    expect(state.week).toBeNull();
    expect(state.releases).toBe(1);
    const healthy = fakeDb();
    expect(
      await sendWeeklyReflectionPrompt(healthy.db, SUN_2000, DEFAULT_PROMPT_SETTINGS, store),
    ).toEqual({ sent: true });
    expect(healthy.notifications).toHaveLength(1);
  });

  test('a failing release is reported, not thrown, and the week stays claimed', async () => {
    const { db } = fakeDb({ failCreate: true });
    const { store, state } = fakeClaims({ failRelease: true });
    expect(await sendWeeklyReflectionPrompt(db, SUN_2000, DEFAULT_PROMPT_SETTINGS, store)).toEqual({
      sent: false,
      reason: 'notification_failed',
    });
    expect(state.week).toBe('2026-11-23');
  });

  test('a changed setting is honoured', async () => {
    const { db } = fakeDb();
    const wed0800 = { dow: 3, time: '08:00' }; // Wed 2026-11-25 08:00 JST = Tue 23:00 UTC
    expect(await sendWeeklyReflectionPrompt(db, new Date('2026-11-24T22:59:00Z'), wed0800)).toEqual(
      {
        sent: false,
        reason: 'not_due',
      },
    );
    expect(await sendWeeklyReflectionPrompt(db, new Date('2026-11-24T23:00:00Z'), wed0800)).toEqual(
      { sent: true },
    );
  });
});
