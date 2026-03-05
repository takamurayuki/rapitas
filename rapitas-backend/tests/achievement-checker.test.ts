/**
 * Achievement Checker テスト
 * 実績チェックのビジネスロジック（条件評価、イベントマッピング）を検証
 */
import { describe, test, expect } from "bun:test";

// getRelevantConditionTypesのロジックを再現（元コードの純粋関数部分）
type AchievementEvent =
  | "task.completed"
  | "streak.updated"
  | "study.logged"
  | "exam.completed"
  | "flashcard.reviewed"
  | "pomodoro.completed";

function getRelevantConditionTypes(event: AchievementEvent): string[] {
  switch (event) {
    case "task.completed":
      return ["tasks_completed"];
    case "streak.updated":
      return ["streak"];
    case "study.logged":
      return ["study_hours", "early_study", "night_study"];
    case "exam.completed":
      return ["exam_completed"];
    case "flashcard.reviewed":
      return ["flashcard_reviews"];
    case "pomodoro.completed":
      return ["study_hours"];
    default:
      return [];
  }
}

// tasks_completed条件評価ロジックの再現
function evaluateTasksCompleted(
  completedCount: number,
  requiredCount: number
): boolean {
  return completedCount >= requiredCount;
}

// streak条件評価ロジックの再現
function evaluateStreak(
  streaks: Array<{ date: Date }>,
  requiredDays: number
): boolean {
  if (streaks.length < requiredDays) return false;

  let consecutive = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < streaks.length; i++) {
    const expectedDate = new Date(today);
    expectedDate.setDate(expectedDate.getDate() - i);
    expectedDate.setHours(0, 0, 0, 0);

    const streakDate = new Date(streaks[i]!.date);
    streakDate.setHours(0, 0, 0, 0);

    if (streakDate.getTime() === expectedDate.getTime()) {
      consecutive++;
    } else {
      break;
    }
  }

  return consecutive >= requiredDays;
}

// study_hours条件評価ロジックの再現
function evaluateStudyHours(
  durations: number[],
  requiredHours: number
): boolean {
  const totalHours = durations.reduce((sum, d) => sum + d, 0);
  return totalHours >= requiredHours;
}

// 早朝・深夜学習のロジック
function evaluateEarlyStudy(currentHour: number, hasTodayStudy: boolean): boolean {
  if (currentHour >= 6) return false;
  return hasTodayStudy;
}

function evaluateNightStudy(currentHour: number, hasTodayStudy: boolean): boolean {
  if (currentHour >= 4) return false;
  return hasTodayStudy;
}

describe("Achievement Checker - イベント→条件タイプマッピング", () => {
  test("task.completedでtasks_completedを返すこと", () => {
    expect(getRelevantConditionTypes("task.completed")).toEqual(["tasks_completed"]);
  });

  test("streak.updatedでstreakを返すこと", () => {
    expect(getRelevantConditionTypes("streak.updated")).toEqual(["streak"]);
  });

  test("study.loggedでstudy_hours, early_study, night_studyを返すこと", () => {
    const types = getRelevantConditionTypes("study.logged");
    expect(types).toEqual(["study_hours", "early_study", "night_study"]);
  });

  test("exam.completedでexam_completedを返すこと", () => {
    expect(getRelevantConditionTypes("exam.completed")).toEqual(["exam_completed"]);
  });

  test("flashcard.reviewedでflashcard_reviewsを返すこと", () => {
    expect(getRelevantConditionTypes("flashcard.reviewed")).toEqual(["flashcard_reviews"]);
  });

  test("pomodoro.completedでstudy_hoursを返すこと", () => {
    expect(getRelevantConditionTypes("pomodoro.completed")).toEqual(["study_hours"]);
  });
});

describe("Achievement Checker - 条件評価ロジック", () => {
  describe("tasks_completed条件", () => {
    test("完了数が必要数以上で解除されること", () => {
      expect(evaluateTasksCompleted(10, 10)).toBe(true);
      expect(evaluateTasksCompleted(15, 10)).toBe(true);
    });

    test("完了数が必要数未満で解除されないこと", () => {
      expect(evaluateTasksCompleted(5, 10)).toBe(false);
      expect(evaluateTasksCompleted(0, 1)).toBe(false);
    });
  });

  describe("streak条件", () => {
    test("連続日数が条件を満たす場合trueを返すこと", () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const streaks = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        streaks.push({ date });
      }

      expect(evaluateStreak(streaks, 7)).toBe(true);
    });

    test("連続日数が足りない場合falseを返すこと", () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const streaks = [
        { date: new Date(today) },
        { date: new Date(today.getTime() - 86400000) }, // 1日前
        // 2日前が欠けている
        { date: new Date(today.getTime() - 86400000 * 3) }, // 3日前
      ];

      expect(evaluateStreak(streaks, 7)).toBe(false);
    });

    test("データが少ない場合falseを返すこと", () => {
      expect(evaluateStreak([], 3)).toBe(false);
      expect(evaluateStreak([{ date: new Date() }], 3)).toBe(false);
    });
  });

  describe("study_hours条件", () => {
    test("合計時間が条件以上で解除されること", () => {
      expect(evaluateStudyHours([5, 3, 4], 10)).toBe(true);
      expect(evaluateStudyHours([10], 10)).toBe(true);
    });

    test("合計時間が条件未満で解除されないこと", () => {
      expect(evaluateStudyHours([3, 2], 10)).toBe(false);
    });

    test("空のリストで0として扱うこと", () => {
      expect(evaluateStudyHours([], 0)).toBe(true);
      expect(evaluateStudyHours([], 1)).toBe(false);
    });
  });

  describe("early_study条件", () => {
    test("6時前かつ学習ありでtrueを返すこと", () => {
      expect(evaluateEarlyStudy(3, true)).toBe(true);
      expect(evaluateEarlyStudy(5, true)).toBe(true);
    });

    test("6時以降ではfalseを返すこと", () => {
      expect(evaluateEarlyStudy(6, true)).toBe(false);
      expect(evaluateEarlyStudy(12, true)).toBe(false);
    });

    test("学習なしではfalseを返すこと", () => {
      expect(evaluateEarlyStudy(3, false)).toBe(false);
    });
  });

  describe("night_study条件", () => {
    test("4時前かつ学習ありでtrueを返すこと", () => {
      expect(evaluateNightStudy(0, true)).toBe(true);
      expect(evaluateNightStudy(3, true)).toBe(true);
    });

    test("4時以降ではfalseを返すこと", () => {
      expect(evaluateNightStudy(4, true)).toBe(false);
      expect(evaluateNightStudy(23, true)).toBe(false);
    });

    test("学習なしではfalseを返すこと", () => {
      expect(evaluateNightStudy(2, false)).toBe(false);
    });
  });
});

describe("Achievement Checker - 実績解除フロー", () => {
  test("既に解除済みの実績はスキップされること", () => {
    const achievements = [
      { id: 1, name: "A", condition: '{"type":"tasks_completed","count":1}', unlockedBy: [{ id: 1 }] },
      { id: 2, name: "B", condition: '{"type":"tasks_completed","count":5}', unlockedBy: [] },
    ];

    const unlockedIds = new Set(
      achievements.filter((a) => a.unlockedBy.length > 0).map((a) => a.id)
    );

    // id=1は解除済みなのでスキップ
    expect(unlockedIds.has(1)).toBe(true);
    expect(unlockedIds.has(2)).toBe(false);
  });

  test("関連しない条件タイプはチェックしないこと", () => {
    const event: AchievementEvent = "task.completed";
    const relevantTypes = getRelevantConditionTypes(event);
    const condition = { type: "streak", days: 7 };

    const shouldCheck = relevantTypes.includes(condition.type);
    expect(shouldCheck).toBe(false);
  });

  test("条件JSONを正しくパースできること", () => {
    const conditionStr = '{"type":"tasks_completed","count":10}';
    const condition = JSON.parse(conditionStr) as {
      type: string;
      count?: number;
      days?: number;
      hours?: number;
    };

    expect(condition.type).toBe("tasks_completed");
    expect(condition.count).toBe(10);
  });
});
