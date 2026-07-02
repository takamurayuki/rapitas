/**
 * weekly-review-service.test.ts
 *
 * Unit tests for the pure helpers in weekly-review-service. The Claude API
 * call and Prisma queries are NOT exercised here — those need integration
 * tests with a live DB / mocked SDK and live in a separate file (or are
 * covered by the manual smoke check in verify.md).
 */
import { describe, it, expect } from 'bun:test';
import {
  getWeekStart,
  getWeekEnd,
  buildPrompt,
  type WeeklyAggregate,
} from './weekly-review-service';

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
