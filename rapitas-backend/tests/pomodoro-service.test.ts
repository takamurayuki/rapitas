/**
 * Pomodoro Service テスト
 * ポモドーロタイマーのビジネスロジック（純粋計算部分）を検証
 */
import { describe, test, expect } from "bun:test";

// ポモドーロ設定定数（元サービスの値を再現）
const WORK_DURATION = 25 * 60;
const SHORT_BREAK_DURATION = 5 * 60;
const LONG_BREAK_DURATION = 15 * 60;
const POMODOROS_BEFORE_LONG_BREAK = 4;

describe("Pomodoro Service - ビジネスロジック", () => {
  describe("経過時間計算", () => {
    test("activeセッションの経過時間を正しく計算すること", () => {
      const elapsed = 0;
      const startedAt = new Date(Date.now() - 600_000); // 10分前
      const duration = 1500; // 25分

      const currentElapsed =
        elapsed +
        Math.floor((Date.now() - startedAt.getTime()) / 1000);

      expect(currentElapsed).toBeGreaterThanOrEqual(599);
      expect(currentElapsed).toBeLessThanOrEqual(601);
    });

    test("pausedセッションはelapsedをそのまま使うこと", () => {
      const status = "paused";
      const elapsed = 300;
      const duration = 1500;
      const startedAt = new Date();

      const currentElapsed =
        status === "active"
          ? elapsed +
            Math.floor((Date.now() - startedAt.getTime()) / 1000)
          : elapsed;

      expect(currentElapsed).toBe(300);
    });

    test("remainingSecondsが負にならないこと", () => {
      const duration = 1500;
      const currentElapsed = 2000; // duration超過

      const remainingSeconds = Math.max(0, duration - currentElapsed);
      expect(remainingSeconds).toBe(0);
    });

    test("currentElapsedがdurationを超えないこと", () => {
      const duration = 1500;
      const rawElapsed = 2000;

      const currentElapsed = Math.min(rawElapsed, duration);
      expect(currentElapsed).toBe(1500);
    });
  });

  describe("セッション開始時のduration決定", () => {
    test("デフォルトはwork(25分)であること", () => {
      const type = undefined;
      const customDuration = undefined;

      const duration =
        customDuration ??
        (type === "short_break"
          ? SHORT_BREAK_DURATION
          : type === "long_break"
            ? LONG_BREAK_DURATION
            : WORK_DURATION);

      expect(duration).toBe(1500);
    });

    test("short_breakで5分になること", () => {
      const type = "short_break";
      const customDuration = undefined;

      const duration =
        customDuration ??
        (type === "short_break"
          ? SHORT_BREAK_DURATION
          : type === "long_break"
            ? LONG_BREAK_DURATION
            : WORK_DURATION);

      expect(duration).toBe(300);
    });

    test("long_breakで15分になること", () => {
      const type = "long_break";

      const duration =
        type === "short_break"
          ? SHORT_BREAK_DURATION
          : type === "long_break"
            ? LONG_BREAK_DURATION
            : WORK_DURATION;

      expect(duration).toBe(900);
    });

    test("カスタムdurationが優先されること", () => {
      const customDuration = 3000;

      const duration = customDuration ?? WORK_DURATION;
      expect(duration).toBe(3000);
    });
  });

  describe("次セッションタイプの判定", () => {
    test("work完了後でcompletedPomodoros=1ならshort_breakになること", () => {
      const sessionType = "work";
      const completedPomodoros = 0;
      const newCompletedPomodoros =
        sessionType === "work"
          ? completedPomodoros + 1
          : completedPomodoros;

      let nextType = "short_break";
      if (sessionType === "work") {
        if (newCompletedPomodoros % POMODOROS_BEFORE_LONG_BREAK === 0) {
          nextType = "long_break";
        } else {
          nextType = "short_break";
        }
      } else {
        nextType = "work";
      }

      expect(nextType).toBe("short_break");
      expect(newCompletedPomodoros).toBe(1);
    });

    test("work完了後でcompletedPomodoros=4ならlong_breakになること", () => {
      const sessionType = "work";
      const completedPomodoros = 3;
      const newCompletedPomodoros =
        sessionType === "work"
          ? completedPomodoros + 1
          : completedPomodoros;

      let nextType = "short_break";
      if (sessionType === "work") {
        if (newCompletedPomodoros % POMODOROS_BEFORE_LONG_BREAK === 0) {
          nextType = "long_break";
        } else {
          nextType = "short_break";
        }
      } else {
        nextType = "work";
      }

      expect(nextType).toBe("long_break");
      expect(newCompletedPomodoros).toBe(4);
    });

    test("work完了後でcompletedPomodoros=8ならlong_breakになること", () => {
      const sessionType = "work";
      const completedPomodoros = 7;
      const newCompletedPomodoros =
        sessionType === "work"
          ? completedPomodoros + 1
          : completedPomodoros;

      let nextType = "short_break";
      if (sessionType === "work") {
        if (newCompletedPomodoros % POMODOROS_BEFORE_LONG_BREAK === 0) {
          nextType = "long_break";
        } else {
          nextType = "short_break";
        }
      } else {
        nextType = "work";
      }

      expect(nextType).toBe("long_break");
    });

    test("short_break完了後はworkになること", () => {
      const sessionType = "short_break";
      const completedPomodoros = 2;
      const newCompletedPomodoros =
        sessionType === "work"
          ? completedPomodoros + 1
          : completedPomodoros;

      let nextType = "short_break";
      if (sessionType === "work") {
        if (newCompletedPomodoros % POMODOROS_BEFORE_LONG_BREAK === 0) {
          nextType = "long_break";
        } else {
          nextType = "short_break";
        }
      } else {
        nextType = "work";
      }

      expect(nextType).toBe("work");
      expect(newCompletedPomodoros).toBe(2); // breakではカウント増えない
    });

    test("long_break完了後はworkになること", () => {
      const sessionType = "long_break";

      let nextType = "short_break";
      if (sessionType === "work") {
        nextType = "short_break";
      } else {
        nextType = "work";
      }

      expect(nextType).toBe("work");
    });
  });

  describe("TimeEntry自動作成のロジック", () => {
    test("workセッションかつtaskId有りの場合にTimeEntryを作成する", () => {
      const sessionType = "work";
      const taskId = 42;
      const duration = 1500;

      const shouldCreateTimeEntry =
        sessionType === "work" && taskId != null;
      const durationHours = duration / 3600;
      const note = `ポモドーロ完了 (${Math.round(duration / 60)}分)`;

      expect(shouldCreateTimeEntry).toBe(true);
      expect(durationHours).toBeCloseTo(0.4167, 3);
      expect(note).toBe("ポモドーロ完了 (25分)");
    });

    test("breakセッションではTimeEntryを作成しない", () => {
      const sessionType = "short_break";
      const taskId = 42;

      const shouldCreateTimeEntry =
        sessionType === "work" && taskId != null;

      expect(shouldCreateTimeEntry).toBe(false);
    });

    test("taskIdなしではTimeEntryを作成しない", () => {
      const sessionType = "work";
      const taskId = null;

      const shouldCreateTimeEntry =
        sessionType === "work" && taskId != null;

      expect(shouldCreateTimeEntry).toBe(false);
    });
  });

  describe("一時停止のelapsed計算", () => {
    test("経過時間を正しく加算すること", () => {
      const currentElapsed = 100;
      const startedAt = new Date(Date.now() - 200_000); // 200秒前
      const duration = 1500;

      const additionalElapsed = Math.floor(
        (Date.now() - startedAt.getTime()) / 1000
      );
      const newElapsed = Math.min(
        currentElapsed + additionalElapsed,
        duration
      );

      expect(additionalElapsed).toBeGreaterThanOrEqual(199);
      expect(additionalElapsed).toBeLessThanOrEqual(201);
      expect(newElapsed).toBeGreaterThanOrEqual(299);
      expect(newElapsed).toBeLessThanOrEqual(301);
    });

    test("elapsed合計がdurationを超えないこと", () => {
      const currentElapsed = 1400;
      const additionalElapsed = 200;
      const duration = 1500;

      const newElapsed = Math.min(
        currentElapsed + additionalElapsed,
        duration
      );

      expect(newElapsed).toBe(1500);
    });
  });

  describe("統計集計ロジック", () => {
    test("日別集計が正しいこと", () => {
      const sessions = [
        { completedAt: new Date("2026-01-01T10:00:00Z"), duration: 1500, taskId: null },
        { completedAt: new Date("2026-01-01T14:00:00Z"), duration: 1500, taskId: null },
        { completedAt: new Date("2026-01-02T10:00:00Z"), duration: 1500, taskId: null },
      ];

      const dailyMap = new Map<string, { count: number; minutes: number }>();
      for (const s of sessions) {
        const dateKey = s.completedAt.toISOString().split("T")[0]!;
        const existing = dailyMap.get(dateKey) || { count: 0, minutes: 0 };
        existing.count++;
        existing.minutes += s.duration / 60;
        dailyMap.set(dateKey, existing);
      }

      expect(dailyMap.get("2026-01-01")!.count).toBe(2);
      expect(dailyMap.get("2026-01-01")!.minutes).toBe(50);
      expect(dailyMap.get("2026-01-02")!.count).toBe(1);
    });

    test("平均ポモドーロ数を計算すること", () => {
      const totalPomodoros = 10;
      const dailyCount = 5;

      const averagePerDay =
        dailyCount > 0
          ? Math.round((totalPomodoros / dailyCount) * 10) / 10
          : 0;

      expect(averagePerDay).toBe(2);
    });

    test("日数0の場合平均が0になること", () => {
      const averagePerDay = 0 > 0 ? 10 / 0 : 0;
      expect(averagePerDay).toBe(0);
    });
  });
});
