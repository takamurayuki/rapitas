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
    test('extracts urgent priority (Japanese)', () => {
      const result = parseNaturalLanguageTask('緊急 レポート提出');
      expect(result.priority).toBe('urgent');
      expect(result.title).toBe('レポート提出');
    });

    test('extracts urgent priority (English)', () => {
      const result = parseNaturalLanguageTask('ASAP submit report');
      expect(result.priority).toBe('urgent');
      expect(result.title).toBe('submit report');
    });

    test('extracts high priority (Japanese)', () => {
      const result = parseNaturalLanguageTask('重要 プレゼン準備');
      expect(result.priority).toBe('high');
      expect(result.title).toBe('プレゼン準備');
    });

    test('extracts high priority (English)', () => {
      const result = parseNaturalLanguageTask('important meeting prep');
      expect(result.priority).toBe('high');
      expect(result.title).toBe('meeting prep');
    });

    test('extracts low priority', () => {
      const result = parseNaturalLanguageTask('低優先 掃除');
      expect(result.priority).toBe('low');
      expect(result.title).toBe('掃除');
    });

    test('returns undefined when no priority specified', () => {
      const result = parseNaturalLanguageTask('買い物に行く');
      expect(result.priority).toBeUndefined();
    });
  });

  describe('estimated hours extraction', () => {
    test('extracts hours (Japanese)', () => {
      const result = parseNaturalLanguageTask('レポート作成 2時間');
      expect(result.estimatedHours).toBe(2);
      expect(result.title).toBe('レポート作成');
    });

    test('extracts hours with decimal', () => {
      const result = parseNaturalLanguageTask('調査 1.5時間');
      expect(result.estimatedHours).toBe(1.5);
    });

    test('extracts hours (English)', () => {
      const result = parseNaturalLanguageTask('write docs 3 hours');
      expect(result.estimatedHours).toBe(3);
      expect(result.title).toBe('write docs');
    });

    test('extracts hours (short form)', () => {
      const result = parseNaturalLanguageTask('review 2h');
      expect(result.estimatedHours).toBe(2);
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
    test('extracts today (Japanese)', () => {
      const result = parseNaturalLanguageTask('今日 買い物');
      expect(result.dueDate).toMatch(/^2026-05-02T23:59$/);
    });

    test('extracts today (English)', () => {
      const result = parseNaturalLanguageTask('today meeting');
      expect(result.dueDate).toMatch(/^2026-05-02T23:59$/);
    });

    test('extracts tomorrow (Japanese)', () => {
      const result = parseNaturalLanguageTask('明日 打ち合わせ');
      expect(result.dueDate).toMatch(/^2026-05-03T23:59$/);
    });

    test('extracts tomorrow (English)', () => {
      const result = parseNaturalLanguageTask('tomorrow review');
      expect(result.dueDate).toMatch(/^2026-05-03T23:59$/);
    });

    test('extracts day after tomorrow', () => {
      const result = parseNaturalLanguageTask('明後日 発表');
      expect(result.dueDate).toMatch(/^2026-05-04T23:59$/);
    });

    test('extracts N days later (Japanese)', () => {
      const result = parseNaturalLanguageTask('3日後 提出');
      expect(result.dueDate).toMatch(/^2026-05-05T23:59$/);
    });

    test('extracts in N days (English)', () => {
      const result = parseNaturalLanguageTask('in 5 days deadline');
      expect(result.dueDate).toMatch(/^2026-05-07T23:59$/);
    });
  });

  describe('date extraction - weekdays', () => {
    test('extracts weekday (Japanese)', () => {
      // May 2, 2026 is Saturday. Friday would be May 8
      const result = parseNaturalLanguageTask('金曜日 会議');
      expect(result.dueDate).toMatch(/^2026-05-08T09:00$/);
    });

    test('extracts weekday (English)', () => {
      const result = parseNaturalLanguageTask('monday meeting');
      expect(result.dueDate).toMatch(/^2026-05-04T09:00$/);
    });

    test('extracts next week weekday (Japanese)', () => {
      const result = parseNaturalLanguageTask('来週月曜 発表');
      expect(result.dueDate).toMatch(/^2026-05-11T09:00$/);
    });

    test('extracts next week weekday (English)', () => {
      const result = parseNaturalLanguageTask('next friday review');
      expect(result.dueDate).toMatch(/^2026-05-15T09:00$/);
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
    test('extracts 24-hour format', () => {
      const result = parseNaturalLanguageTask('15:30 会議');
      expect(result.dueDate).toMatch(/T15:30$/);
    });

    test('extracts Japanese time format', () => {
      const result = parseNaturalLanguageTask('3時半 打ち合わせ');
      expect(result.dueDate).toMatch(/T15:30$/);
    });

    test('extracts AM/PM Japanese format', () => {
      const result = parseNaturalLanguageTask('午後3時 ミーティング');
      expect(result.dueDate).toMatch(/T15:00$/);
    });

    test('extracts pm format', () => {
      const result = parseNaturalLanguageTask('3pm meeting');
      expect(result.dueDate).toMatch(/T15:00$/);
    });

    test('extracts am format', () => {
      const result = parseNaturalLanguageTask('10am standup');
      expect(result.dueDate).toMatch(/T10:00$/);
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
    test('removes trailing particles', () => {
      const result = parseNaturalLanguageTask('明日までにレポート');
      expect(result.title).toBe('レポート');
    });

    test('removes leading particles', () => {
      const result = parseNaturalLanguageTask('にレポート作成 明日');
      expect(result.title).toBe('レポート作成');
    });

    test('removes "by" keyword', () => {
      const result = parseNaturalLanguageTask('by tomorrow submit report');
      expect(result.title).toBe('submit report');
    });

    test('falls back to original input if title becomes empty', () => {
      const result = parseNaturalLanguageTask('明日');
      expect(result.title).toBe('明日');
    });
  });
});
