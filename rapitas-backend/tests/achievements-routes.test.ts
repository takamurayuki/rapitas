/**
 * Achievements Routes テスト
 * 実績APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  achievement: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    createMany: mock(() => Promise.resolve({ count: 0 })),
  },
  userAchievement: {
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
  },
  task: {
    count: mock(() => Promise.resolve(0)),
  },
  examGoal: {
    count: mock(() => Promise.resolve(0)),
  },
  flashcard: {
    aggregate: mock(() => Promise.resolve({ _sum: { reviewCount: 0 } })),
  },
  studyStreak: {
    findFirst: mock(() => Promise.resolve(null)),
  },
  timeEntry: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module("../config/database", () => ({ prisma: mockPrisma }));
mock.module("../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { achievementsRoutes } = await import(
  "../routes/analytics/achievements"
);

function resetAllMocks() {
  for (const model of Object.values(mockPrisma)) {
    if (typeof model === "object" && model !== null) {
      for (const method of Object.values(model)) {
        if (typeof method === "function" && "mockReset" in method) {
          (method as ReturnType<typeof mock>).mockReset();
        }
      }
    }
  }
  mockPrisma.achievement.findMany.mockResolvedValue([]);
  mockPrisma.achievement.findUnique.mockResolvedValue(null);
  mockPrisma.achievement.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.userAchievement.findUnique.mockResolvedValue(null);
  mockPrisma.userAchievement.create.mockResolvedValue({ id: 1 });
  mockPrisma.task.count.mockResolvedValue(0);
  mockPrisma.examGoal.count.mockResolvedValue(0);
  mockPrisma.flashcard.aggregate.mockResolvedValue({ _sum: { reviewCount: 0 } });
  mockPrisma.studyStreak.findFirst.mockResolvedValue(null);
  mockPrisma.timeEntry.findMany.mockResolvedValue([]);
}

function createApp() {
  return new Elysia().use(achievementsRoutes);
}

describe("GET /achievements/", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("実績一覧を返すこと", async () => {
    const achievements = [
      {
        id: 1,
        key: "first_task",
        name: "はじめの一歩",
        description: "最初のタスクを完了",
        icon: "Star",
        color: "#FFD700",
        category: "tasks",
        condition: '{"type":"tasks_completed","count":1}',
        rarity: "common",
        unlockedBy: [],
      },
      {
        id: 2,
        key: "task_10",
        name: "やる気満々",
        description: "10個のタスクを完了",
        icon: "Zap",
        color: "#F59E0B",
        category: "tasks",
        condition: '{"type":"tasks_completed","count":10}',
        rarity: "common",
        unlockedBy: [{ unlockedAt: new Date("2026-03-01") }],
      },
    ];
    mockPrisma.achievement.findMany.mockResolvedValue(achievements);

    const res = await app.handle(
      new Request("http://localhost/achievements/"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0].isUnlocked).toBe(false);
    expect(body[1].isUnlocked).toBe(true);
  });

  test("実績が未登録の場合、初期データを作成して返すこと", async () => {
    // 最初のfindManyでは空 → createMany → 2回目のfindManyで返す
    const initialAchievements = [
      {
        id: 1,
        key: "first_task",
        name: "はじめの一歩",
        description: "最初のタスクを完了",
        icon: "Star",
        color: "#FFD700",
        category: "tasks",
        condition: '{"type":"tasks_completed","count":1}',
        rarity: "common",
        unlockedBy: [],
      },
    ];
    mockPrisma.achievement.findMany
      .mockResolvedValueOnce([]) // first call returns empty
      .mockResolvedValueOnce(initialAchievements); // after createMany

    const res = await app.handle(
      new Request("http://localhost/achievements/"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.achievement.createMany).toHaveBeenCalledTimes(1);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  test("解除済み実績にunlockedAtが含まれること", async () => {
    const unlockedDate = new Date("2026-02-15T12:00:00Z");
    const achievements = [
      {
        id: 1,
        key: "first_task",
        name: "はじめの一歩",
        description: "最初のタスクを完了",
        icon: "Star",
        color: "#FFD700",
        category: "tasks",
        condition: '{"type":"tasks_completed","count":1}',
        rarity: "common",
        unlockedBy: [{ unlockedAt: unlockedDate }],
      },
    ];
    mockPrisma.achievement.findMany.mockResolvedValue(achievements);

    const res = await app.handle(
      new Request("http://localhost/achievements/"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].isUnlocked).toBe(true);
    expect(body[0].unlockedAt).toBeDefined();
  });

  test("未解除実績のunlockedAtがnullであること", async () => {
    const achievements = [
      {
        id: 1,
        key: "task_100",
        name: "タスクマスター",
        description: "100個のタスクを完了",
        icon: "Crown",
        color: "#EC4899",
        category: "tasks",
        condition: '{"type":"tasks_completed","count":100}',
        rarity: "epic",
        unlockedBy: [],
      },
    ];
    mockPrisma.achievement.findMany.mockResolvedValue(achievements);

    const res = await app.handle(
      new Request("http://localhost/achievements/"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].isUnlocked).toBe(false);
    expect(body[0].unlockedAt).toBeNull();
  });
});
