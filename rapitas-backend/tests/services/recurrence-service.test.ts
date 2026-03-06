/**
 * Recurrence Service テスト
 * RRULE解析・シリアライズ・日付展開の純粋関数テスト
 */
import { describe, test, expect } from "bun:test";
import {
  parseRRule,
  serializeRRule,
  expandRecurrence,
  RECURRENCE_PRESETS,
  type RRule,
} from "../../services/recurrence-service";

describe("parseRRule", () => {
  test("基本的なDAILYルールをパースすること", () => {
    const result = parseRRule("FREQ=DAILY;INTERVAL=1");
    expect(result.freq).toBe("DAILY");
    expect(result.interval).toBe(1);
  });

  test("WEEKLYルールをBYDAY付きでパースすること", () => {
    const result = parseRRule("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR");
    expect(result.freq).toBe("WEEKLY");
    expect(result.interval).toBe(1);
    expect(result.byday).toEqual(["MO", "WE", "FR"]);
  });

  test("MONTHLYルールをBYMONTHDAY付きでパースすること", () => {
    const result = parseRRule("FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=1,15");
    expect(result.freq).toBe("MONTHLY");
    expect(result.bymonthday).toEqual([1, 15]);
  });

  test("COUNT制限をパースすること", () => {
    const result = parseRRule("FREQ=DAILY;COUNT=10");
    expect(result.count).toBe(10);
  });

  test("UNTIL制限をパースすること", () => {
    const result = parseRRule("FREQ=DAILY;UNTIL=2026-12-31T00:00:00.000Z");
    expect(result.until).toBeInstanceOf(Date);
    expect(result.until!.getFullYear()).toBe(2026);
  });

  test("INTERVAL=2をパースすること", () => {
    const result = parseRRule("FREQ=WEEKLY;INTERVAL=2");
    expect(result.interval).toBe(2);
  });

  test("FREQのみの場合デフォルトinterval=1になること", () => {
    const result = parseRRule("FREQ=YEARLY");
    expect(result.freq).toBe("YEARLY");
    expect(result.interval).toBe(1);
  });

  test("空の値を持つパーツを無視すること", () => {
    const result = parseRRule("FREQ=DAILY;=;INTERVAL=1");
    expect(result.freq).toBe("DAILY");
    expect(result.interval).toBe(1);
  });
});

describe("serializeRRule", () => {
  test("基本的なDAILYルールをシリアライズすること", () => {
    const rule: RRule = { freq: "DAILY", interval: 1 };
    expect(serializeRRule(rule)).toBe("FREQ=DAILY");
  });

  test("interval>1の場合INTERVALを含めること", () => {
    const rule: RRule = { freq: "WEEKLY", interval: 2 };
    expect(serializeRRule(rule)).toBe("FREQ=WEEKLY;INTERVAL=2");
  });

  test("BYDAYをシリアライズすること", () => {
    const rule: RRule = { freq: "WEEKLY", interval: 1, byday: ["MO", "WE", "FR"] };
    expect(serializeRRule(rule)).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });

  test("BYMONTHDAYをシリアライズすること", () => {
    const rule: RRule = { freq: "MONTHLY", interval: 1, bymonthday: [1, 15] };
    expect(serializeRRule(rule)).toBe("FREQ=MONTHLY;BYMONTHDAY=1,15");
  });

  test("COUNTをシリアライズすること", () => {
    const rule: RRule = { freq: "DAILY", interval: 1, count: 5 };
    expect(serializeRRule(rule)).toBe("FREQ=DAILY;COUNT=5");
  });

  test("UNTILをシリアライズすること", () => {
    const until = new Date("2026-12-31T00:00:00.000Z");
    const rule: RRule = { freq: "DAILY", interval: 1, until };
    const result = serializeRRule(rule);
    expect(result).toContain("UNTIL=");
    expect(result).toContain("2026-12-31");
  });

  test("parseとserializeのラウンドトリップが正しく動作すること", () => {
    const original = "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR";
    const parsed = parseRRule(original);
    const serialized = serializeRRule(parsed);
    expect(serialized).toBe(original);
  });
});

describe("expandRecurrence", () => {
  test("DAILY展開が正しい日数を生成すること", () => {
    const start = new Date("2026-01-01");
    const rangeStart = new Date("2026-01-01");
    const rangeEnd = new Date("2026-01-05");
    const rule: RRule = { freq: "DAILY", interval: 1 };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    expect(dates.length).toBe(5); // 1/1, 1/2, 1/3, 1/4, 1/5
  });

  test("DAILY interval=2で隔日生成すること", () => {
    const start = new Date("2026-01-01");
    const rangeStart = new Date("2026-01-01");
    const rangeEnd = new Date("2026-01-10");
    const rule: RRule = { freq: "DAILY", interval: 2 };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    expect(dates.length).toBe(5); // 1/1, 1/3, 1/5, 1/7, 1/9
  });

  test("WEEKLY展開（BYDAYなし）で週次生成すること", () => {
    const start = new Date("2026-01-01"); // Thursday
    const rangeStart = new Date("2026-01-01");
    const rangeEnd = new Date("2026-01-31");
    const rule: RRule = { freq: "WEEKLY", interval: 1 };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    // 1/1, 1/8, 1/15, 1/22, 1/29 = 5 Thursdays
    expect(dates.length).toBe(5);
    // 各日付が7日間隔であること
    for (let i = 1; i < dates.length; i++) {
      const diff = dates[i]!.getTime() - dates[i - 1]!.getTime();
      expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });

  test("WEEKLY BYDAY指定で特定曜日のみ生成すること", () => {
    // 2026-01-05はMonday
    const start = new Date("2026-01-05");
    const rangeStart = new Date("2026-01-05");
    const rangeEnd = new Date("2026-01-11"); // Sunday
    const rule: RRule = { freq: "WEEKLY", interval: 1, byday: ["MO", "FR"] };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    // Monday(1/5) and Friday(1/9) = 2
    expect(dates.length).toBe(2);
    expect(dates[0]!.getDay()).toBe(1); // Monday
    expect(dates[1]!.getDay()).toBe(5); // Friday
  });

  test("MONTHLY展開で月次生成すること", () => {
    const start = new Date("2026-01-15");
    const rangeStart = new Date("2026-01-01");
    const rangeEnd = new Date("2026-04-30");
    const rule: RRule = { freq: "MONTHLY", interval: 1 };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    expect(dates.length).toBe(4); // 1/15, 2/15, 3/15, 4/15
  });

  test("MONTHLY BYMONTHDAY指定で特定日のみ生成すること", () => {
    const start = new Date("2026-01-01");
    const rangeStart = new Date("2026-01-01");
    const rangeEnd = new Date("2026-02-28");
    const rule: RRule = { freq: "MONTHLY", interval: 1, bymonthday: [1, 15] };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    // 1/1, 1/15, 2/1, 2/15 = 4
    expect(dates.length).toBe(4);
  });

  test("YEARLY展開で年次生成すること", () => {
    const start = new Date("2026-06-15");
    const rangeStart = new Date("2026-01-01");
    const rangeEnd = new Date("2029-12-31");
    const rule: RRule = { freq: "YEARLY", interval: 1 };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    expect(dates.length).toBe(4); // 2026, 2027, 2028, 2029
  });

  test("COUNT制限で生成数を制限すること", () => {
    const start = new Date("2026-01-01");
    const rangeStart = new Date("2026-01-01");
    const rangeEnd = new Date("2026-12-31");
    const rule: RRule = { freq: "DAILY", interval: 1, count: 3 };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    expect(dates.length).toBe(3);
  });

  test("UNTIL制限で期日を超えないこと", () => {
    const start = new Date("2026-01-01");
    const rangeStart = new Date("2026-01-01");
    const rangeEnd = new Date("2026-12-31");
    const until = new Date("2026-01-05");
    const rule: RRule = { freq: "DAILY", interval: 1, until };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    expect(dates.length).toBe(5); // 1/1 ~ 1/5
    for (const d of dates) {
      expect(d.getTime()).toBeLessThanOrEqual(until.getTime());
    }
  });

  test("recurrenceEndで終了日を制限すること", () => {
    const start = new Date("2026-01-01");
    const rangeStart = new Date("2026-01-01");
    const rangeEnd = new Date("2026-12-31");
    const recurrenceEnd = new Date("2026-01-03");
    const rule: RRule = { freq: "DAILY", interval: 1 };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd, recurrenceEnd);
    expect(dates.length).toBe(3); // 1/1, 1/2, 1/3
  });

  test("maxOccurrencesで生成数を制限すること", () => {
    const start = new Date("2026-01-01");
    const rangeStart = new Date("2026-01-01");
    const rangeEnd = new Date("2030-12-31");
    const rule: RRule = { freq: "DAILY", interval: 1 };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd, null, 10);
    expect(dates.length).toBe(10);
  });

  test("rangeStartより前の日付を除外すること", () => {
    const start = new Date("2026-01-01");
    const rangeStart = new Date("2026-01-05");
    const rangeEnd = new Date("2026-01-10");
    const rule: RRule = { freq: "DAILY", interval: 1 };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    expect(dates.length).toBe(6); // 1/5 ~ 1/10
    for (const d of dates) {
      expect(d.getTime()).toBeGreaterThanOrEqual(rangeStart.getTime());
    }
  });

  test("UNTILがrangeStartより前の場合空配列を返すこと", () => {
    const start = new Date("2026-01-01");
    const rangeStart = new Date("2026-06-01");
    const rangeEnd = new Date("2026-12-31");
    const rule: RRule = { freq: "DAILY", interval: 1, until: new Date("2026-03-01") };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    expect(dates.length).toBe(0);
  });

  test("空の範囲で空配列を返すこと", () => {
    const start = new Date("2026-06-01");
    const rangeStart = new Date("2026-01-01");
    const rangeEnd = new Date("2026-01-31");
    const rule: RRule = { freq: "DAILY", interval: 1 };

    const dates = expandRecurrence(start, rule, rangeStart, rangeEnd);
    expect(dates.length).toBe(0);
  });
});

describe("RECURRENCE_PRESETS", () => {
  test("dailyプリセットが正しいこと", () => {
    expect(RECURRENCE_PRESETS.daily).toBe("FREQ=DAILY;INTERVAL=1");
  });

  test("weekdaysプリセットが平日のみ含むこと", () => {
    expect(RECURRENCE_PRESETS.weekdays).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
  });

  test("weeklyプリセットが正しいこと", () => {
    expect(RECURRENCE_PRESETS.weekly).toBe("FREQ=WEEKLY;INTERVAL=1");
  });

  test("biweeklyプリセットがINTERVAL=2であること", () => {
    expect(RECURRENCE_PRESETS.biweekly).toBe("FREQ=WEEKLY;INTERVAL=2");
  });

  test("monthlyプリセットが正しいこと", () => {
    expect(RECURRENCE_PRESETS.monthly).toBe("FREQ=MONTHLY;INTERVAL=1");
  });

  test("yearlyプリセットが正しいこと", () => {
    expect(RECURRENCE_PRESETS.yearly).toBe("FREQ=YEARLY;INTERVAL=1");
  });

  test("プリセットがparseRRuleで正しくパースできること", () => {
    for (const [, value] of Object.entries(RECURRENCE_PRESETS)) {
      const parsed = parseRRule(value);
      expect(parsed.freq).toBeDefined();
      expect(parsed.interval).toBeGreaterThanOrEqual(1);
    }
  });
});
