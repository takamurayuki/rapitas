/**
 * Recurrence Service テスト
 * RRULE形式の繰り返しルールの解析と日付展開のテスト
 */
import { describe, test, expect } from "bun:test";
import {
  parseRRule,
  serializeRRule,
  expandRecurrence,
  RECURRENCE_PRESETS,
  type RRule,
} from "../services/recurrence-service";

describe("parseRRule", () => {
  test("FREQ=DAILYをパースできること", () => {
    const result = parseRRule("FREQ=DAILY");
    expect(result.freq).toBe("DAILY");
    expect(result.interval).toBe(1);
  });

  test("FREQ=WEEKLYをパースできること", () => {
    const result = parseRRule("FREQ=WEEKLY");
    expect(result.freq).toBe("WEEKLY");
  });

  test("FREQ=MONTHLYをパースできること", () => {
    const result = parseRRule("FREQ=MONTHLY");
    expect(result.freq).toBe("MONTHLY");
  });

  test("FREQ=YEARLYをパースできること", () => {
    const result = parseRRule("FREQ=YEARLY");
    expect(result.freq).toBe("YEARLY");
  });

  test("INTERVALをパースできること", () => {
    const result = parseRRule("FREQ=WEEKLY;INTERVAL=2");
    expect(result.interval).toBe(2);
  });

  test("BYDAYをパースできること", () => {
    const result = parseRRule("FREQ=WEEKLY;BYDAY=MO,WE,FR");
    expect(result.byday).toEqual(["MO", "WE", "FR"]);
  });

  test("BYMONTHDAYをパースできること", () => {
    const result = parseRRule("FREQ=MONTHLY;BYMONTHDAY=1,15");
    expect(result.bymonthday).toEqual([1, 15]);
  });

  test("COUNTをパースできること", () => {
    const result = parseRRule("FREQ=DAILY;COUNT=10");
    expect(result.count).toBe(10);
  });

  test("UNTILをパースできること", () => {
    const result = parseRRule("FREQ=DAILY;UNTIL=2026-12-31T00:00:00.000Z");
    expect(result.until).toBeInstanceOf(Date);
    expect(result.until!.getFullYear()).toBe(2026);
  });

  test("全フィールドを含むルールをパースできること", () => {
    const result = parseRRule(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=20"
    );
    expect(result.freq).toBe("WEEKLY");
    expect(result.interval).toBe(2);
    expect(result.byday).toEqual(["MO", "FR"]);
    expect(result.count).toBe(20);
  });

  test("不正なパートを無視すること", () => {
    const result = parseRRule("FREQ=DAILY;INVALID;INTERVAL=3");
    expect(result.freq).toBe("DAILY");
    expect(result.interval).toBe(3);
  });
});

describe("serializeRRule", () => {
  test("最小限のルールをシリアライズできること", () => {
    const rule: RRule = { freq: "DAILY", interval: 1 };
    expect(serializeRRule(rule)).toBe("FREQ=DAILY");
  });

  test("interval>1の場合INTERVALを含むこと", () => {
    const rule: RRule = { freq: "WEEKLY", interval: 2 };
    expect(serializeRRule(rule)).toBe("FREQ=WEEKLY;INTERVAL=2");
  });

  test("BYDAYを含むルールをシリアライズできること", () => {
    const rule: RRule = {
      freq: "WEEKLY",
      interval: 1,
      byday: ["MO", "WE", "FR"],
    };
    expect(serializeRRule(rule)).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
  });

  test("BYMONTHDAYを含むルールをシリアライズできること", () => {
    const rule: RRule = {
      freq: "MONTHLY",
      interval: 1,
      bymonthday: [1, 15],
    };
    expect(serializeRRule(rule)).toBe("FREQ=MONTHLY;BYMONTHDAY=1,15");
  });

  test("COUNTを含むルールをシリアライズできること", () => {
    const rule: RRule = { freq: "DAILY", interval: 1, count: 5 };
    expect(serializeRRule(rule)).toBe("FREQ=DAILY;COUNT=5");
  });

  test("parseRRuleの逆変換であること", () => {
    const original = "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=20";
    const parsed = parseRRule(original);
    const serialized = serializeRRule(parsed);
    expect(serialized).toBe(original);
  });
});

describe("expandRecurrence", () => {
  const baseDate = new Date(2026, 0, 1); // 2026-01-01 (Thursday)
  const rangeStart = new Date(2026, 0, 1);
  const rangeEnd = new Date(2026, 0, 31);

  describe("DAILY展開", () => {
    test("毎日のイベントを展開できること", () => {
      const rule = parseRRule("FREQ=DAILY;INTERVAL=1");
      const dates = expandRecurrence(baseDate, rule, rangeStart, rangeEnd);
      expect(dates.length).toBe(31);
    });

    test("2日おきのイベントを展開できること", () => {
      const rule = parseRRule("FREQ=DAILY;INTERVAL=2");
      const dates = expandRecurrence(baseDate, rule, rangeStart, rangeEnd);
      expect(dates.length).toBe(16); // 1,3,5,...,31
    });
  });

  describe("WEEKLY展開", () => {
    test("毎週のイベントを展開できること", () => {
      const rule = parseRRule("FREQ=WEEKLY;INTERVAL=1");
      const dates = expandRecurrence(baseDate, rule, rangeStart, rangeEnd);
      // 1/1, 1/8, 1/15, 1/22, 1/29
      expect(dates.length).toBe(5);
    });

    test("BYDAY指定で特定曜日のみ展開すること", () => {
      const rule = parseRRule("FREQ=WEEKLY;BYDAY=MO,FR");
      const dates = expandRecurrence(baseDate, rule, rangeStart, rangeEnd);
      for (const d of dates) {
        const day = d.getDay();
        expect(day === 1 || day === 5).toBe(true); // Monday or Friday
      }
    });
  });

  describe("MONTHLY展開", () => {
    test("毎月のイベントを展開できること", () => {
      const rule = parseRRule("FREQ=MONTHLY;INTERVAL=1");
      const rangeEndYear = new Date(2026, 11, 31);
      const dates = expandRecurrence(
        baseDate,
        rule,
        rangeStart,
        rangeEndYear
      );
      expect(dates.length).toBe(12);
    });

    test("BYMONTHDAY指定で特定日のみ展開すること", () => {
      const rule = parseRRule("FREQ=MONTHLY;BYMONTHDAY=1,15");
      const rangeEndMonths = new Date(2026, 2, 31); // 3 months
      const dates = expandRecurrence(
        baseDate,
        rule,
        rangeStart,
        rangeEndMonths
      );
      for (const d of dates) {
        expect(d.getDate() === 1 || d.getDate() === 15).toBe(true);
      }
    });
  });

  describe("YEARLY展開", () => {
    test("毎年のイベントを展開できること", () => {
      const rule = parseRRule("FREQ=YEARLY;INTERVAL=1");
      const rangeEndYears = new Date(2030, 11, 31);
      const dates = expandRecurrence(
        baseDate,
        rule,
        rangeStart,
        rangeEndYears
      );
      expect(dates.length).toBe(5); // 2026-2030
    });
  });

  describe("制限", () => {
    test("COUNTで件数制限できること", () => {
      const rule = parseRRule("FREQ=DAILY;COUNT=5");
      const dates = expandRecurrence(baseDate, rule, rangeStart, rangeEnd);
      expect(dates.length).toBe(5);
    });

    test("UNTILで期間制限できること", () => {
      const rule = parseRRule("FREQ=DAILY;UNTIL=2026-01-10T00:00:00.000Z");
      const dates = expandRecurrence(baseDate, rule, rangeStart, rangeEnd);
      for (const d of dates) {
        expect(d.getTime()).toBeLessThanOrEqual(
          new Date("2026-01-10T00:00:00.000Z").getTime()
        );
      }
    });

    test("maxOccurrencesで上限を設定できること", () => {
      const rule = parseRRule("FREQ=DAILY;INTERVAL=1");
      const farEnd = new Date(2030, 0, 1);
      const dates = expandRecurrence(
        baseDate,
        rule,
        rangeStart,
        farEnd,
        null,
        10
      );
      expect(dates.length).toBe(10);
    });

    test("recurrenceEndで繰り返し終了日を設定できること", () => {
      const rule = parseRRule("FREQ=DAILY;INTERVAL=1");
      const recEnd = new Date(2026, 0, 10);
      const dates = expandRecurrence(
        baseDate,
        rule,
        rangeStart,
        rangeEnd,
        recEnd
      );
      for (const d of dates) {
        expect(d.getTime()).toBeLessThanOrEqual(recEnd.getTime());
      }
    });

    test("範囲外の日付を除外すること", () => {
      const rule = parseRRule("FREQ=DAILY;INTERVAL=1");
      const laterStart = new Date(2026, 0, 15);
      const dates = expandRecurrence(
        baseDate,
        rule,
        laterStart,
        rangeEnd
      );
      for (const d of dates) {
        expect(d.getTime()).toBeGreaterThanOrEqual(laterStart.getTime());
      }
    });

    test("UNTILがrangeStartより前の場合空配列を返すこと", () => {
      const rule = parseRRule("FREQ=DAILY;UNTIL=2025-01-01T00:00:00.000Z");
      const dates = expandRecurrence(baseDate, rule, rangeStart, rangeEnd);
      expect(dates.length).toBe(0);
    });
  });
});

describe("RECURRENCE_PRESETS", () => {
  test("dailyプリセットが正しいこと", () => {
    const rule = parseRRule(RECURRENCE_PRESETS.daily);
    expect(rule.freq).toBe("DAILY");
    expect(rule.interval).toBe(1);
  });

  test("weekdaysプリセットが平日のみであること", () => {
    const rule = parseRRule(RECURRENCE_PRESETS.weekdays);
    expect(rule.freq).toBe("WEEKLY");
    expect(rule.byday).toEqual(["MO", "TU", "WE", "TH", "FR"]);
  });

  test("biweeklyプリセットがinterval=2であること", () => {
    const rule = parseRRule(RECURRENCE_PRESETS.biweekly);
    expect(rule.freq).toBe("WEEKLY");
    expect(rule.interval).toBe(2);
  });
});
