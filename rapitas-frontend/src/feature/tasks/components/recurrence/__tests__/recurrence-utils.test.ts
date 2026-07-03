/**
 * recurrence-utils.test.ts
 *
 * buildCustomRule のRRULE組み立てロジックと、describeRule の頻度・間隔・
 * 曜日指定に応じた分岐（DAILY/WEEKLY/MONTHLY/YEARLY・不明な頻度へのフォール
 * バック）を検証する。
 */
import { describe, it, expect } from 'vitest';
import { buildCustomRule, describeRule, WEEKDAYS } from '../recurrence-utils';

/** Key-echo translator stub: returns the key, with interpolated values JSON-appended. */
const t = (key: string, values?: Record<string, string | number>) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

describe('WEEKDAYS', () => {
  it('月〜日の7曜日をこの順序で持つこと', () => {
    expect(WEEKDAYS.map((w) => w.key)).toEqual(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
  });
});

describe('buildCustomRule', () => {
  it('DAILYの場合はFREQとINTERVALのみを含むこと', () => {
    expect(buildCustomRule('DAILY', 2, [])).toBe('FREQ=DAILY;INTERVAL=2');
  });

  it('WEEKLYで選択曜日がある場合はBYDAYを付加すること', () => {
    expect(buildCustomRule('WEEKLY', 1, ['MO', 'WE'])).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE');
  });

  it('WEEKLYで選択曜日が空の場合はBYDAYを付加しないこと', () => {
    expect(buildCustomRule('WEEKLY', 1, [])).toBe('FREQ=WEEKLY;INTERVAL=1');
  });

  it('MONTHLYの場合は選択曜日を無視すること', () => {
    expect(buildCustomRule('MONTHLY', 3, ['MO'])).toBe('FREQ=MONTHLY;INTERVAL=3');
  });
});

describe('describeRule', () => {
  it('ruleがnullの場合はrecurrenceDesc.noneを返すこと', () => {
    expect(describeRule(null, t)).toBe('recurrenceDesc.none');
  });

  describe('DAILY', () => {
    it('interval=1の場合はdailyを返すこと', () => {
      expect(describeRule('FREQ=DAILY;INTERVAL=1', t)).toBe('recurrenceDesc.daily');
    });

    it('interval>1の場合はdailyIntervalをinterval付きで返すこと', () => {
      expect(describeRule('FREQ=DAILY;INTERVAL=3', t)).toBe(
        'recurrenceDesc.dailyInterval:{"interval":3}',
      );
    });
  });

  describe('WEEKLY', () => {
    it('BYDAYなし・interval=1の場合はweeklyを返すこと', () => {
      expect(describeRule('FREQ=WEEKLY;INTERVAL=1', t)).toBe('recurrenceDesc.weekly');
    });

    it('BYDAYなし・interval>1の場合はweeklyIntervalを返すこと', () => {
      expect(describeRule('FREQ=WEEKLY;INTERVAL=2', t)).toBe(
        'recurrenceDesc.weeklyInterval:{"interval":2}',
      );
    });

    it('BYDAYが平日5日全てを含む場合はweekdaysOnlyを返すこと', () => {
      expect(describeRule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TU,WE,TH,FR', t)).toBe(
        'recurrenceDesc.weekdaysOnly',
      );
    });

    it('BYDAYが平日5日と順序が異なっても検出されること', () => {
      expect(describeRule('FREQ=WEEKLY;INTERVAL=1;BYDAY=FR,MO,WE,TU,TH', t)).toBe(
        'recurrenceDesc.weekdaysOnly',
      );
    });

    it('BYDAYが一部の曜日のみ・interval=1の場合はweeklyWithDaysを翻訳済み曜日名で返すこと', () => {
      expect(describeRule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE', t)).toBe(
        'recurrenceDesc.weeklyWithDays:{"days":"weekday.mon, weekday.wed"}',
      );
    });

    it('BYDAYが一部の曜日のみ・interval>1の場合はweeklyIntervalWithDaysを返すこと', () => {
      expect(describeRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', t)).toBe(
        'recurrenceDesc.weeklyIntervalWithDays:{"interval":2,"days":"weekday.tue"}',
      );
    });

    it('BYDAYに未知の曜日キーが含まれる場合は無視されること', () => {
      expect(describeRule('FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,XX', t)).toBe(
        'recurrenceDesc.weeklyWithDays:{"days":"weekday.mon"}',
      );
    });
  });

  describe('MONTHLY', () => {
    it('interval=1の場合はmonthlyを返すこと', () => {
      expect(describeRule('FREQ=MONTHLY;INTERVAL=1', t)).toBe('recurrenceDesc.monthly');
    });

    it('interval>1の場合はmonthlyIntervalを返すこと', () => {
      expect(describeRule('FREQ=MONTHLY;INTERVAL=2', t)).toBe(
        'recurrenceDesc.monthlyInterval:{"interval":2}',
      );
    });
  });

  describe('YEARLY', () => {
    it('interval=1の場合はyearlyを返すこと', () => {
      expect(describeRule('FREQ=YEARLY;INTERVAL=1', t)).toBe('recurrenceDesc.yearly');
    });

    it('interval>1の場合はyearlyIntervalを返すこと', () => {
      expect(describeRule('FREQ=YEARLY;INTERVAL=4', t)).toBe(
        'recurrenceDesc.yearlyInterval:{"interval":4}',
      );
    });
  });

  describe('不明な頻度', () => {
    it('FREQが未知の場合は元のrule文字列をそのまま返すこと', () => {
      expect(describeRule('FREQ=HOURLY;INTERVAL=1', t)).toBe('FREQ=HOURLY;INTERVAL=1');
    });

    it('INTERVALが指定されていない場合は1として扱うこと', () => {
      expect(describeRule('FREQ=DAILY', t)).toBe('recurrenceDesc.daily');
    });
  });
});
