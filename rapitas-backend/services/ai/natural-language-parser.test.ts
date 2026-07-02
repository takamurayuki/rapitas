import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { parseNaturalLanguageTask } from './natural-language-parser';

describe('parseNaturalLanguageTask', () => {
  // Store original Date and mock it for consistent testing
  let originalDate: typeof Date;
  const MOCK_NOW = new Date('2026-05-02T10:00:00');

  beforeEach(() => {
    originalDate = global.Date;
    // @ts-expect-error - mocking Date constructor
    global.Date = class extends originalDate {
      constructor(...args: Parameters<typeof originalDate>) {
        if (args.length === 0) {
          super(MOCK_NOW.getTime());
        } else {
          // @ts-expect-error - spread args
          super(...args);
        }
      }
      static now() {
        return MOCK_NOW.getTime();
      }
    };
  });

  afterEach(() => {
    global.Date = originalDate;
  });

  describe('priority extraction', () => {
    test.each([
      {
        name: 'urgent priority (Japanese)',
        input: '緊急 レポート提出',
        priority: 'urgent',
        title: 'レポート提出',
      },
      {
        name: 'urgent priority (English)',
        input: 'ASAP submit report',
        priority: 'urgent',
        title: 'submit report',
      },
      {
        name: 'high priority (Japanese)',
        input: '重要 プレゼン準備',
        priority: 'high',
        title: 'プレゼン準備',
      },
      {
        name: 'high priority (English)',
        input: 'important meeting prep',
        priority: 'high',
        title: 'meeting prep',
      },
      { name: 'low priority', input: '低優先 掃除', priority: 'low', title: '掃除' },
    ])('extracts $name', ({ input, priority, title }) => {
      const result = parseNaturalLanguageTask(input);
      expect(result.priority).toBe(priority);
      expect(result.title).toBe(title);
    });

    test('returns undefined when no priority specified', () => {
      const result = parseNaturalLanguageTask('買い物に行く');
      expect(result.priority).toBeUndefined();
    });
  });

  describe('estimated hours extraction', () => {
    test.each([
      { name: 'hours (Japanese)', input: 'レポート作成 2時間', hours: 2, title: 'レポート作成' },
      { name: 'hours with decimal', input: '調査 1.5時間', hours: 1.5, title: undefined },
      { name: 'hours (English)', input: 'write docs 3 hours', hours: 3, title: 'write docs' },
      { name: 'hours (short form)', input: 'review 2h', hours: 2, title: undefined },
    ])('extracts $name', ({ input, hours, title }) => {
      const result = parseNaturalLanguageTask(input);
      expect(result.estimatedHours).toBe(hours);
      // Only some original cases asserted title; preserve exactly which ones did.
      if (title !== undefined) {
        expect(result.title).toBe(title);
      }
    });

    test('converts minutes to hours', () => {
      const result = parseNaturalLanguageTask('電話する 30分');
      expect(result.estimatedHours).toBe(0.5);
    });

    test('extracts approximate hours', () => {
      const result = parseNaturalLanguageTask('約2時間のミーティング');
      expect(result.estimatedHours).toBe(2);
    });
  });

  describe('date extraction - relative dates', () => {
    test.each([
      { name: 'today (Japanese)', input: '今日 買い物', due: /^2026-05-02T23:59$/ },
      { name: 'today (English)', input: 'today meeting', due: /^2026-05-02T23:59$/ },
      { name: 'tomorrow (Japanese)', input: '明日 打ち合わせ', due: /^2026-05-03T23:59$/ },
      { name: 'tomorrow (English)', input: 'tomorrow review', due: /^2026-05-03T23:59$/ },
      { name: 'day after tomorrow', input: '明後日 発表', due: /^2026-05-04T23:59$/ },
      { name: 'N days later (Japanese)', input: '3日後 提出', due: /^2026-05-05T23:59$/ },
      { name: 'in N days (English)', input: 'in 5 days deadline', due: /^2026-05-07T23:59$/ },
    ])('extracts $name', ({ input, due }) => {
      const result = parseNaturalLanguageTask(input);
      expect(result.dueDate).toMatch(due);
    });
  });

  describe('date extraction - weekdays', () => {
    test.each([
      // May 2, 2026 is Saturday. Friday would be May 8
      { name: 'weekday (Japanese)', input: '金曜日 会議', due: /^2026-05-08T09:00$/ },
      { name: 'weekday (English)', input: 'monday meeting', due: /^2026-05-04T09:00$/ },
      { name: 'next week weekday (Japanese)', input: '来週月曜 発表', due: /^2026-05-11T09:00$/ },
      {
        name: 'next week weekday (English)',
        input: 'next friday review',
        due: /^2026-05-15T09:00$/,
      },
    ])('extracts $name', ({ input, due }) => {
      const result = parseNaturalLanguageTask(input);
      expect(result.dueDate).toMatch(due);
    });
  });

  describe('date extraction - absolute dates', () => {
    test('extracts Japanese date format', () => {
      const result = parseNaturalLanguageTask('5月15日 締め切り');
      expect(result.dueDate).toMatch(/^2026-05-15T23:59$/);
    });

    test('extracts slash date format', () => {
      const result = parseNaturalLanguageTask('6/1 deadline');
      expect(result.dueDate).toMatch(/^2026-06-01T23:59$/);
    });

    test('rolls over to next year for past dates', () => {
      const result = parseNaturalLanguageTask('1月1日 新年');
      expect(result.dueDate).toMatch(/^2027-01-01T23:59$/);
    });
  });

  describe('time extraction', () => {
    test.each([
      { name: '24-hour format', input: '15:30 会議', due: /T15:30$/ },
      { name: 'Japanese time format', input: '3時半 打ち合わせ', due: /T15:30$/ },
      { name: 'AM/PM Japanese format', input: '午後3時 ミーティング', due: /T15:00$/ },
      { name: 'pm format', input: '3pm meeting', due: /T15:00$/ },
      { name: 'am format', input: '10am standup', due: /T10:00$/ },
    ])('extracts $name', ({ input, due }) => {
      const result = parseNaturalLanguageTask(input);
      expect(result.dueDate).toMatch(due);
    });

    test('combines date and time', () => {
      const result = parseNaturalLanguageTask('明日 10:00 打ち合わせ');
      expect(result.dueDate).toBe('2026-05-03T10:00');
    });
  });

  describe('combined extraction', () => {
    test('extracts all fields together', () => {
      const result = parseNaturalLanguageTask('来週月曜 10:00 会議の準備 2時間 重要');
      expect(result.title).toBe('会議の準備');
      expect(result.dueDate).toBe('2026-05-11T10:00');
      expect(result.estimatedHours).toBe(2);
      expect(result.priority).toBe('high');
    });

    test('handles complex Japanese input', () => {
      const result = parseNaturalLanguageTask('金曜3時にレポート提出 緊急');
      expect(result.title).toBe('レポート提出');
      expect(result.priority).toBe('urgent');
      expect(result.dueDate).toMatch(/T15:00$/);
    });

    test('preserves title when nothing else matched', () => {
      const result = parseNaturalLanguageTask('シンプルなタスク');
      expect(result.title).toBe('シンプルなタスク');
      expect(result.dueDate).toBeUndefined();
      expect(result.priority).toBeUndefined();
      expect(result.estimatedHours).toBeUndefined();
    });
  });

  describe('title cleanup', () => {
    test.each([
      { name: 'trailing particles', input: '明日までにレポート', title: 'レポート' },
      { name: 'leading particles', input: 'にレポート作成 明日', title: 'レポート作成' },
      { name: '"by" keyword', input: 'by tomorrow submit report', title: 'submit report' },
    ])('removes $name', ({ input, title }) => {
      const result = parseNaturalLanguageTask(input);
      expect(result.title).toBe(title);
    });

    test('falls back to original input if title becomes empty', () => {
      const result = parseNaturalLanguageTask('明日');
      expect(result.title).toBe('明日');
    });
  });
});
