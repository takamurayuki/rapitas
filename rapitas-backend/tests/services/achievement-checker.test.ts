/**
 * Achievement Checker Service テスト
 * getRelevantConditionTypesのイベント→条件タイプマッピングと
 * checkAchievementsの基本動作テスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";

// Prisma と notification-service をモック
const mockPrisma = {
  achievement: {
    findMany: mock(() => Promise.resolve([])),
  },
  userAchievement: {
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({})),
  },
  notification: {
    create: mock(() => Promise.resolve({})),
    count: mock(() => Promise.resolve(0)),
  },
  task: { count: mock(() => Promise.resolve(0)) },
  studyStreak: { findMany: mock(() => Promise.resolve([])), findFirst: mock(() => Promise.resolve(null)) },
  timeEntry: { findMany: mock(() => Promise.resolve([])) },
  examGoal: { count: mock(() => Promise.resolve(0)) },
  flashcard: { aggregate: mock(() => Promise.resolve({ _sum: { reviewCount: 0 } })) },
};

mock.module("../config/database", () => ({
  prisma: mockPrisma,
}));

mock.module("./notification-service", () => ({
  notifyAchievementUnlocked: mock(() => Promise.resolve()),
}));

const { checkAchievements } = await import("../services/achievement-checker");

describe("checkAchievements", () => {
  beforeEach(() => {
    // Reset all mocks
    mockPrisma.achievement.findMany.mockReset();
    mockPrisma.achievement.findMany.mockResolvedValue([]);
    mockPrisma.userAchievement.findUnique.mockReset();
    mockPrisma.userAchievement.create.mockReset();
    mockPrisma.notification.create.mockReset();
    mockPrisma.task.count.mockReset();
  });

  test("実績がない場合何もしないこと", async () => {
    mockPrisma.achievement.findMany.mockResolvedValue([]);
    await checkAchievements("task.completed");
    // No error thrown
    expect(mockPrisma.achievement.findMany).toHaveBeenCalled();
  });

  test("既に解除済みの実績はスキップすること", async () => {
    mockPrisma.achievement.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Test Achievement",
        icon: "🏆",
        condition: JSON.stringify({ type: "tasks_completed", count: 1 }),
        unlockedBy: [{ id: 1 }], // already unlocked
      },
    ]);

    await checkAchievements("task.completed");
    expect(mockPrisma.task.count).not.toHaveBeenCalled();
  });

  test("task.completedイベントでtasks_completed条件をチェックすること", async () => {
    mockPrisma.achievement.findMany.mockResolvedValue([
      {
        id: 1,
        name: "First Task",
        icon: "✅",
        condition: JSON.stringify({ type: "tasks_completed", count: 1 }),
        unlockedBy: [],
      },
    ]);
    mockPrisma.task.count.mockResolvedValue(5);
    mockPrisma.userAchievement.findUnique.mockResolvedValue(null);
    mockPrisma.userAchievement.create.mockResolvedValue({});

    await checkAchievements("task.completed");
    expect(mockPrisma.task.count).toHaveBeenCalled();
    expect(mockPrisma.userAchievement.create).toHaveBeenCalled();
  });

  test("条件を満たさない場合解除しないこと", async () => {
    mockPrisma.achievement.findMany.mockResolvedValue([
      {
        id: 1,
        name: "100 Tasks",
        icon: "💯",
        condition: JSON.stringify({ type: "tasks_completed", count: 100 }),
        unlockedBy: [],
      },
    ]);
    mockPrisma.task.count.mockResolvedValue(5);

    await checkAchievements("task.completed");
    expect(mockPrisma.userAchievement.create).not.toHaveBeenCalled();
  });

  test("関連しないイベントタイプでは条件をチェックしないこと", async () => {
    mockPrisma.achievement.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Task Master",
        icon: "✅",
        condition: JSON.stringify({ type: "tasks_completed", count: 1 }),
        unlockedBy: [],
      },
    ]);

    // streak.updated event should not trigger tasks_completed check
    await checkAchievements("streak.updated");
    expect(mockPrisma.task.count).not.toHaveBeenCalled();
  });

  test("pomodoro.completedイベントでstudy_hours条件をチェックすること", async () => {
    mockPrisma.achievement.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Study 10 Hours",
        icon: "📚",
        condition: JSON.stringify({ type: "study_hours", hours: 10 }),
        unlockedBy: [],
      },
    ]);
    mockPrisma.timeEntry.findMany.mockResolvedValue([
      { duration: 5 },
      { duration: 6 },
    ]);
    mockPrisma.userAchievement.findUnique.mockResolvedValue(null);
    mockPrisma.userAchievement.create.mockResolvedValue({});

    await checkAchievements("pomodoro.completed");
    expect(mockPrisma.timeEntry.findMany).toHaveBeenCalled();
    expect(mockPrisma.userAchievement.create).toHaveBeenCalled();
  });

  test("flashcard.reviewedイベントでflashcard_reviews条件をチェックすること", async () => {
    mockPrisma.achievement.findMany.mockResolvedValue([
      {
        id: 1,
        name: "Review Master",
        icon: "🃏",
        condition: JSON.stringify({ type: "flashcard_reviews", count: 100 }),
        unlockedBy: [],
      },
    ]);
    mockPrisma.flashcard.aggregate.mockResolvedValue({
      _sum: { reviewCount: 150 },
    });
    mockPrisma.userAchievement.findUnique.mockResolvedValue(null);
    mockPrisma.userAchievement.create.mockResolvedValue({});

    await checkAchievements("flashcard.reviewed");
    expect(mockPrisma.flashcard.aggregate).toHaveBeenCalled();
    expect(mockPrisma.userAchievement.create).toHaveBeenCalled();
  });

  test("エラー発生時に例外を投げないこと（fire-and-forget）", async () => {
    mockPrisma.achievement.findMany.mockRejectedValue(new Error("DB error"));
    // Should not throw
    await checkAchievements("task.completed");
  });

  test("レースコンディション防止: 既に解除済みの場合createしないこと", async () => {
    mockPrisma.achievement.findMany.mockResolvedValue([
      {
        id: 1,
        name: "First Task",
        icon: "✅",
        condition: JSON.stringify({ type: "tasks_completed", count: 1 }),
        unlockedBy: [],
      },
    ]);
    mockPrisma.task.count.mockResolvedValue(5);
    // findUnique returns existing record (race condition)
    mockPrisma.userAchievement.findUnique.mockResolvedValue({ id: 1, achievementId: 1 });

    await checkAchievements("task.completed");
    expect(mockPrisma.userAchievement.create).not.toHaveBeenCalled();
  });
});
