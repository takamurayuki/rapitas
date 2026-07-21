/**
 * weekly-review-service.test.ts
 *
 * Unit tests for the pure helpers in weekly-review-service. The Claude API
 * call and Prisma queries are NOT exercised here — those need integration
 * tests with a live DB / mocked SDK and live in a separate file (or are
 * covered by the manual smoke check in verify.md).
 */
import { describe, it, expect, mock, afterEach } from 'bun:test';
import type { WeeklyAggregate } from './weekly-review-service';

const mockGetAuxAiMode = mock(() => 'api' as 'api' | 'cli' | 'off');
const mockGetApiKeyForProvider = mock(() => Promise.resolve('sk-test-key'));
const mockCallClaudeCli = mock(() =>
  Promise.resolve({ content: 'CLI 経由のレビュー', tokensUsed: 10 }),
);
mock.module('../../utils/ai-client', () => ({
  getAuxAiMode: mockGetAuxAiMode,
  getApiKeyForProvider: mockGetApiKeyForProvider,
  callClaudeCli: mockCallClaudeCli,
}));

const mockAnthropicCreate = mock(() =>
  Promise.resolve({ content: [{ type: 'text', text: 'API 経由のレビュー' }] }),
);
mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockAnthropicCreate };
  },
}));

const {
  getWeekStart,
  getWeekEnd,
  buildPrompt,
  aggregateWeeklyData,
  callClaudeForReview,
  generateWeeklyReview,
  getLatestWeeklyReview,
  getWeeklyReviews,
  deleteWeeklyReview,
} = await import('./weekly-review-service');

describe('getWeekStart', () => {
  it.each([
    // 2026-04-06 is a Monday
    {
      name: 'same Monday when called on a Monday',
      input: '2026-04-06T15:30:00Z',
      hours: 0,
      minutes: 0,
    },
    // 2026-04-12 is a Sunday → previous Monday is 2026-04-06
    {
      name: 'previous Monday when called on a Sunday',
      input: '2026-04-12T20:00:00Z',
      hours: undefined,
      minutes: undefined,
    },
    // 2026-04-08 is a Wednesday → previous Monday is 2026-04-06
    {
      name: 'previous Monday when called on a Wednesday',
      input: '2026-04-08T12:00:00Z',
      hours: undefined,
      minutes: undefined,
    },
  ])('returns the $name', ({ input, hours, minutes }) => {
    const result = getWeekStart(new Date(input));
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(6);
    // Only the Monday case originally asserted time-of-day; preserve that distinction.
    if (hours !== undefined) {
      expect(result.getHours()).toBe(hours);
    }
    if (minutes !== undefined) {
      expect(result.getMinutes()).toBe(minutes);
    }
  });

  it('normalizes time to midnight', () => {
    const noon = new Date('2026-04-08T12:34:56.789Z');
    const result = getWeekStart(noon);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });
});

describe('getWeekEnd', () => {
  it('returns Sunday 23:59:59.999 of the same week as the given Monday', () => {
    const monday = getWeekStart(new Date('2026-04-08T12:00:00Z'));
    const end = getWeekEnd(monday);
    expect(end.getDay()).toBe(0); // Sunday
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
    // Difference should be 6 days, 23:59:59.999
    expect(end.getTime() - monday.getTime()).toBe(
      6 * 86_400_000 + 23 * 3_600_000 + 59 * 60_000 + 59_000 + 999,
    );
  });
});

describe('buildPrompt', () => {
  const sampleAggregate: WeeklyAggregate = {
    weekStart: new Date('2026-04-06T00:00:00Z'),
    weekEnd: new Date('2026-04-12T23:59:59.999Z'),
    completedTasks: [
      {
        title: 'タスク A',
        themeName: 'テーマ X',
        completedAt: new Date('2026-04-07T10:00:00Z'),
        actualHours: 2.5,
        estimatedHours: 2.0,
      },
      {
        title: 'タスク B',
        themeName: null,
        completedAt: new Date('2026-04-08T15:00:00Z'),
        actualHours: null,
        estimatedHours: null,
      },
    ],
    totalCompletedCount: 2,
    totalFocusMinutes: 90,
    totalTimeEntryMinutes: 180,
    pomodoroSessions: 4,
    topThemes: [{ name: 'テーマ X', count: 1 }],
    dailyDistribution: { '2026-04-07': 1, '2026-04-08': 1 },
  };

  it.each([
    { name: 'the period in the prompt', contains: ['2026-04-06', '2026-04-12'] },
    { name: 'the completed task count', contains: ['完了タスク (2件)'] },
    {
      name: 'task titles with theme name when available',
      contains: ['タスク A', '[テーマ X]', '(2.5h)'],
    },
    {
      name: 'pomodoro and time entry totals',
      contains: ['ポモドーロ完了セッション: 4回', '集中時間 90分', 'TimeEntry 合計: 180分'],
    },
  ])('includes $name', ({ contains }) => {
    const prompt = buildPrompt(sampleAggregate);
    for (const substr of contains) {
      expect(prompt).toContain(substr);
    }
  });

  it('handles empty task list with placeholder', () => {
    const empty: WeeklyAggregate = {
      ...sampleAggregate,
      completedTasks: [],
      totalCompletedCount: 0,
      topThemes: [],
      dailyDistribution: {},
    };
    const prompt = buildPrompt(empty);
    expect(prompt).toContain('完了タスク (0件)');
    expect(prompt).toContain('- (なし)');
  });

  it('truncates long task lists with a "他 N 件" line', () => {
    const many: WeeklyAggregate = {
      ...sampleAggregate,
      completedTasks: Array.from({ length: 35 }, (_, i) => ({
        title: `タスク ${i + 1}`,
        themeName: null,
        completedAt: new Date('2026-04-07T10:00:00Z'),
        actualHours: null,
        estimatedHours: null,
      })),
      totalCompletedCount: 35,
    };
    const prompt = buildPrompt(many);
    expect(prompt).toContain('他 5 件');
    // First 30 tasks should appear
    expect(prompt).toContain('タスク 30');
    // 31st should not
    expect(prompt).not.toContain('タスク 31');
  });

  it('asks Claude for a 200-400 character review with a 1-paragraph constraint', () => {
    const prompt = buildPrompt(sampleAggregate);
    expect(prompt).toContain('200-400 字');
    expect(prompt).toContain('1 段落');
  });
});

/** Minimal shape covering only the calls weekly-review-service makes. */
function makePrismaMock(overrides: Record<string, unknown> = {}) {
  return {
    task: { findMany: mock(() => Promise.resolve([])) },
    pomodoroSession: { findMany: mock(() => Promise.resolve([])) },
    timeEntry: { findMany: mock(() => Promise.resolve([])) },
    weeklyReview: {
      findUnique: mock(() => Promise.resolve(null)),
      findFirst: mock(() => Promise.resolve(null)),
      findMany: mock(() => Promise.resolve([])),
      create: mock((args: { data: unknown }) => Promise.resolve({ id: 1, ...args.data })),
      delete: mock(() => Promise.resolve(undefined)),
    },
    ...overrides,
    // biome-ignore lint: test helper, shape intentionally loose
  } as any;
}

describe('aggregateWeeklyData', () => {
  it('sums pomodoro focus minutes (preferring elapsed over duration) and time-entry hours to minutes', async () => {
    const prisma = makePrismaMock({
      pomodoroSession: {
        findMany: mock(() =>
          Promise.resolve([
            { duration: 1500, elapsed: 1200 }, // prefers elapsed: 1200s
            { duration: 900, elapsed: 0 }, // elapsed falsy -> falls back to duration: 900s
          ]),
        ),
      },
      timeEntry: { findMany: mock(() => Promise.resolve([{ duration: 1.5 }, { duration: 0.5 }])) },
    });
    const result = await aggregateWeeklyData(prisma, new Date('2026-04-06T00:00:00Z'));
    expect(result.totalFocusMinutes).toBe(Math.round((1200 + 900) / 60));
    expect(result.totalTimeEntryMinutes).toBe(120); // (1.5 + 0.5) * 60
    expect(result.pomodoroSessions).toBe(2);
  });

  it('groups completed tasks by theme (top 5) and by completion day', async () => {
    const prisma = makePrismaMock({
      task: {
        findMany: mock(() =>
          Promise.resolve([
            {
              title: 'A',
              completedAt: new Date('2026-04-07T10:00:00Z'),
              actualHours: 1,
              estimatedHours: 1,
              theme: { name: 'テーマ1' },
            },
            {
              title: 'B',
              completedAt: new Date('2026-04-07T11:00:00Z'),
              actualHours: null,
              estimatedHours: null,
              theme: { name: 'テーマ1' },
            },
            {
              title: 'C',
              completedAt: new Date('2026-04-08T09:00:00Z'),
              actualHours: null,
              estimatedHours: null,
              theme: null,
            },
          ]),
        ),
      },
    });
    const result = await aggregateWeeklyData(prisma, new Date('2026-04-06T00:00:00Z'));
    expect(result.totalCompletedCount).toBe(3);
    expect(result.topThemes).toEqual([
      { name: 'テーマ1', count: 2 },
      { name: '(なし)', count: 1 },
    ]);
    expect(result.dailyDistribution).toEqual({ '2026-04-07': 2, '2026-04-08': 1 });
    expect(result.completedTasks[2]?.themeName).toBeNull();
  });
});

describe('callClaudeForReview', () => {
  afterEach(() => {
    mockGetAuxAiMode.mockReset();
    mockGetAuxAiMode.mockImplementation(() => 'api');
    mockCallClaudeCli.mockClear();
    mockAnthropicCreate.mockClear();
    mockGetApiKeyForProvider.mockClear();
  });

  it('throws when the aux AI kill switch is off', async () => {
    mockGetAuxAiMode.mockImplementation(() => 'off');
    await expect(callClaudeForReview('prompt')).rejects.toThrow('RAPITAS_AUX_AI=off');
  });

  it('uses the subscription CLI when auxMode is cli, trimming the response', async () => {
    mockGetAuxAiMode.mockImplementation(() => 'cli');
    mockCallClaudeCli.mockImplementation(() =>
      Promise.resolve({ content: '  CLI reply  ', tokensUsed: 3 }),
    );
    const result = await callClaudeForReview('prompt');
    expect(result).toBe('CLI reply');
    expect(mockCallClaudeCli).toHaveBeenCalled();
  });

  it('throws when the CLI returns an empty response', async () => {
    mockGetAuxAiMode.mockImplementation(() => 'cli');
    mockCallClaudeCli.mockImplementation(() => Promise.resolve({ content: '   ', tokensUsed: 0 }));
    await expect(callClaudeForReview('prompt')).rejects.toThrow('empty response');
  });

  it('calls the Anthropic API directly when auxMode is api', async () => {
    mockGetAuxAiMode.mockImplementation(() => 'api');
    mockGetApiKeyForProvider.mockImplementation(() => Promise.resolve('sk-test-key'));
    const result = await callClaudeForReview('prompt', 'claude-haiku-4-5-20251001');
    expect(result).toBe('API 経由のレビュー');
    expect(mockAnthropicCreate).toHaveBeenCalled();
  });

  it('throws when no API key is configured (db and env both empty)', async () => {
    mockGetAuxAiMode.mockImplementation(() => 'api');
    mockGetApiKeyForProvider.mockImplementation(() => Promise.resolve(null));
    const originalEnvKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(callClaudeForReview('prompt')).rejects.toThrow(
        'Anthropic API key is not configured',
      );
    } finally {
      if (originalEnvKey !== undefined) process.env.ANTHROPIC_API_KEY = originalEnvKey;
    }
  });

  it('throws when the Anthropic API returns no text blocks', async () => {
    mockGetAuxAiMode.mockImplementation(() => 'api');
    mockGetApiKeyForProvider.mockImplementation(() => Promise.resolve('sk-test-key'));
    mockAnthropicCreate.mockImplementation(() => Promise.resolve({ content: [] }));
    await expect(callClaudeForReview('prompt')).rejects.toThrow('empty response');
  });
});

describe('generateWeeklyReview', () => {
  const weekStart = new Date('2026-04-06T00:00:00Z');

  it('returns the cached review without re-aggregating or calling Claude when one already exists', async () => {
    const existing = { id: 99, weekStart, summary: 'cached' };
    const prisma = makePrismaMock({
      weeklyReview: {
        findUnique: mock(() => Promise.resolve(existing)),
        create: mock(() => Promise.reject(new Error('should not be called'))),
      },
    });
    const result = await generateWeeklyReview(prisma, weekStart);
    expect(result).toBe(existing);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });

  it('creates a fallback review without calling Claude for a fully empty week', async () => {
    const created: { data?: unknown } = {};
    const prisma = makePrismaMock({
      weeklyReview: {
        findUnique: mock(() => Promise.resolve(null)),
        create: mock((args: { data: { summary: string; modelUsed: string } }) => {
          created.data = args.data;
          return Promise.resolve({ id: 1, ...args.data });
        }),
      },
    });
    await generateWeeklyReview(prisma, weekStart);
    const data = created.data as { summary: string; modelUsed: string };
    expect(data.modelUsed).toBe('fallback');
    expect(data.summary).toContain('活動がありませんでした');
  });

  it('aggregates, calls Claude, and persists a real review for a non-empty week', async () => {
    mockGetAuxAiMode.mockReset();
    mockGetAuxAiMode.mockImplementation(() => 'cli');
    mockCallClaudeCli.mockReset();
    mockCallClaudeCli.mockImplementation(() =>
      Promise.resolve({ content: '今週も頑張りました', tokensUsed: 5 }),
    );
    const created: { data?: unknown } = {};
    const prisma = makePrismaMock({
      task: {
        findMany: mock(() =>
          Promise.resolve([
            {
              title: 'A',
              completedAt: new Date('2026-04-07T10:00:00Z'),
              actualHours: 1,
              estimatedHours: 1,
              theme: null,
            },
          ]),
        ),
      },
      weeklyReview: {
        findUnique: mock(() => Promise.resolve(null)),
        create: mock((args: { data: unknown }) => {
          created.data = args.data;
          return Promise.resolve({ id: 2, ...args.data });
        }),
      },
    });
    const result = await generateWeeklyReview(prisma, weekStart);
    expect((created.data as { summary: string }).summary).toBe('今週も頑張りました');
    expect((result as { summary: string }).summary).toBe('今週も頑張りました');
  });
});

describe('getLatestWeeklyReview / getWeeklyReviews / deleteWeeklyReview', () => {
  it('getLatestWeeklyReview returns the most recent review ordered by weekStart desc', async () => {
    const latest = { id: 5, weekStart: new Date() };
    const prisma = makePrismaMock({
      weeklyReview: { findFirst: mock(() => Promise.resolve(latest)) },
    });
    expect(await getLatestWeeklyReview(prisma)).toBe(latest);
    expect(prisma.weeklyReview.findFirst).toHaveBeenCalledWith({
      orderBy: { weekStart: 'desc' },
    });
  });

  it('getWeeklyReviews clamps limit into [1, 52]', async () => {
    const findMany = mock(() => Promise.resolve([]));
    const prisma = makePrismaMock({ weeklyReview: { findMany } });

    await getWeeklyReviews(prisma, 0);
    expect(findMany).toHaveBeenLastCalledWith({ orderBy: { weekStart: 'desc' }, take: 1 });

    await getWeeklyReviews(prisma, 1000);
    expect(findMany).toHaveBeenLastCalledWith({ orderBy: { weekStart: 'desc' }, take: 52 });

    await getWeeklyReviews(prisma, 10);
    expect(findMany).toHaveBeenLastCalledWith({ orderBy: { weekStart: 'desc' }, take: 10 });
  });

  it('deleteWeeklyReview deletes by id', async () => {
    const del = mock(() => Promise.resolve(undefined));
    const prisma = makePrismaMock({ weeklyReview: { delete: del } });
    await deleteWeeklyReview(prisma, 7);
    expect(del).toHaveBeenCalledWith({ where: { id: 7 } });
  });
});
