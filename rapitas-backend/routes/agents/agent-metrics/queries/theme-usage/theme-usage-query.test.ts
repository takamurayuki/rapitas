/**
 * theme-usage-query unit tests
 *
 * Verifies the daily × theme aggregation of tokens / executions / durationMs,
 * that costUsd only counts executions with a real (> 0) cost via
 * costKnownCount, pre-seeded day buckets, the 未分類 bucket and window
 * exclusion.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const execFind = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const sessionFind = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const configFind = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const taskFind = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const themeFind = mock((_args: unknown) => Promise.resolve([] as unknown[]));
mock.module('../../../../../config/database', () => ({
  prisma: {
    agentExecution: { findMany: execFind },
    agentSession: { findMany: sessionFind },
    developerModeConfig: { findMany: configFind },
    task: { findMany: taskFind },
    theme: { findMany: themeFind },
  },
}));

import { getThemeUsage, aggregateThemeDaily, loadUsageSamples } from './theme-usage-query';

const NOW = new Date('2026-10-10T12:00:00Z');

function exec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: 1,
    startedAt: new Date('2026-10-10T01:00:00Z'),
    createdAt: new Date('2026-10-10T01:00:00Z'),
    tokensUsed: 0,
    inputTokens: 100,
    outputTokens: 50,
    executionTimeMs: 2000,
    costUsd: 0,
    ...overrides,
  };
}

beforeEach(() => {
  for (const m of [execFind, sessionFind, configFind, taskFind, themeFind]) {
    m.mockReset();
    m.mockImplementation(() => Promise.resolve([]));
  }
  // Session 1 → theme 7 ("Alpha"); session 2 → theme-less task; session 3 → broken.
  sessionFind.mockImplementation(() =>
    Promise.resolve([
      { id: 1, configId: 11 },
      { id: 2, configId: 12 },
    ]),
  );
  configFind.mockImplementation(() =>
    Promise.resolve([
      { id: 11, taskId: 101 },
      { id: 12, taskId: 102 },
    ]),
  );
  taskFind.mockImplementation(() =>
    Promise.resolve([
      { id: 101, themeId: 7, title: 'alpha task' },
      { id: 102, themeId: null, title: 'billing cleanup' },
    ]),
  );
  themeFind.mockImplementation(() => Promise.resolve([{ id: 7, name: 'Alpha' }]));
});

describe('getThemeUsage', () => {
  test('aggregates tokens / executions / duration per day and theme', async () => {
    execFind.mockImplementation(() =>
      Promise.resolve([
        exec({ tokensUsed: 1000 }),
        exec({ startedAt: new Date('2026-10-09T05:00:00Z') }),
        exec({ sessionId: 2 }),
        exec({ sessionId: 3 }),
      ]),
    );
    const r = await getThemeUsage({ days: 3, tzOffsetMinutes: 0, rules: [], now: NOW });

    expect(r.daily.map((d) => d.date)).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
    const today = r.daily[2];
    expect(today.byTheme['7']).toMatchObject({ tokens: 1000, executions: 1, durationMs: 2000 });
    expect(today.byTheme['0']).toMatchObject({ tokens: 300, executions: 2 });
    expect(r.daily[1].byTheme['7']).toMatchObject({ tokens: 150, executions: 1 });
    expect(r.daily[0].total.executions).toBe(0);

    const alpha = r.themes.find((t) => t.themeId === 7);
    expect(alpha).toMatchObject({ themeName: 'Alpha', tokens: 1150, executions: 2 });
    expect(r.themes.find((t) => t.themeId === 0)?.themeName).toBeNull();
    expect(r.unresolvedCount).toBe(1);
  });

  test('applies classification rules to theme-less tasks', async () => {
    execFind.mockImplementation(() => Promise.resolve([exec({ sessionId: 2 })]));
    const r = await getThemeUsage({
      days: 1,
      tzOffsetMinutes: 0,
      rules: [{ themeId: 7, keyword: 'BILLING', sortOrder: 0, enabled: true }],
      now: NOW,
    });
    expect(r.themes).toHaveLength(1);
    expect(r.themes[0]).toMatchObject({ themeId: 7, executions: 1 });
  });

  test('costUsd counts only executions with a real cost; costKnownCount tracks them', async () => {
    execFind.mockImplementation(() =>
      Promise.resolve([exec({ costUsd: '0.5' }), exec({ costUsd: 0 }), exec({ costUsd: null })]),
    );
    const r = await getThemeUsage({ days: 1, tzOffsetMinutes: 0, rules: [], now: NOW });
    const alpha = r.themes[0];
    expect(alpha.costUsd).toBe(0.5);
    expect(alpha.costKnownCount).toBe(1);
    expect(alpha.executionCount).toBe(3);
  });

  test('queries only the needed columns from the window start', async () => {
    await getThemeUsage({ days: 7, tzOffsetMinutes: 0, rules: [], now: NOW });
    const args = execFind.mock.calls[0][0] as {
      where: { createdAt: { gte: Date } };
      select: Record<string, boolean>;
    };
    expect(args.where.createdAt.gte.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(args.select.output).toBeUndefined();
    expect(args.select.sessionId).toBe(true);
  });
});

describe('aggregateThemeDaily', () => {
  test('drops samples outside the seeded day range', () => {
    const r = aggregateThemeDaily(
      [
        {
          at: new Date('2026-09-01T00:00:00Z'),
          tokens: 9,
          durationMs: 0,
          costUsd: 0,
          themeId: 1,
        },
      ],
      { days: 2, tzOffsetMinutes: 0, now: NOW, themeNames: new Map() },
    );
    expect(r.themes).toEqual([]);
    expect(r.daily).toHaveLength(2);
  });

  test('buckets by the local date under a timezone offset', () => {
    const r = aggregateThemeDaily(
      [
        {
          at: new Date('2026-10-09T20:00:00Z'), // 10/10 05:00 JST
          tokens: 5,
          durationMs: 0,
          costUsd: 0,
          themeId: 1,
        },
      ],
      { days: 2, tzOffsetMinutes: 540, now: NOW, themeNames: new Map() },
    );
    expect(r.daily[1].date).toBe('2026-10-10');
    expect(r.daily[1].total.tokens).toBe(5);
  });
});

describe('loadUsageSamples', () => {
  test('counts executions whose join chain broke', async () => {
    execFind.mockImplementation(() =>
      Promise.resolve([exec({ sessionId: 3 }), exec({ sessionId: 1 })]),
    );
    const r = await loadUsageSamples(new Date('2026-10-01T00:00:00Z'), [], NOW);
    expect(r.samples).toHaveLength(2);
    expect(r.unresolvedCount).toBe(1);
  });
});
