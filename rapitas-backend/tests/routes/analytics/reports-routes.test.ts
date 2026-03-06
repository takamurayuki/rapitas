/**
 * Reports Routes テスト
 * レポートAPIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  task: {
    count: mock(() => Promise.resolve(0)),
    findMany: mock(() => Promise.resolve([])),
    groupBy: mock(() => Promise.resolve([])),
  },
  timeEntry: {
    findMany: mock(() => Promise.resolve([])),
  },
  theme: {
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

const { reportsRoutes } = await import("../routes/analytics/reports");

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
  mockPrisma.task.count.mockResolvedValue(0);
  mockPrisma.task.findMany.mockResolvedValue([]);
  mockPrisma.task.groupBy.mockResolvedValue([]);
  mockPrisma.timeEntry.findMany.mockResolvedValue([]);
}

function createApp() {
  return new Elysia().use(reportsRoutes);
}

describe("GET /reports/weekly", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("週間レポートの基本構造を返すこと", async () => {
    // thisWeekTasks, lastWeekTasks, + 7 daily task counts = 9 count calls
    mockPrisma.task.count.mockResolvedValue(0);
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    mockPrisma.task.groupBy.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/reports/weekly"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.period).toBeDefined();
    expect(body.period.start).toBeDefined();
    expect(body.period.end).toBeDefined();
    expect(body.summary).toBeDefined();
    expect(body.dailyData).toBeDefined();
    expect(body.subjectBreakdown).toBeDefined();
  });

  test("タスク完了数と学習時間が正しく集計されること", async () => {
    // First two count calls: thisWeekTasks=5, lastWeekTasks=3
    mockPrisma.task.count
      .mockResolvedValueOnce(5) // thisWeekTasks
      .mockResolvedValueOnce(3) // lastWeekTasks
      .mockResolvedValue(0); // dailyData counts

    mockPrisma.timeEntry.findMany
      .mockResolvedValueOnce([{ duration: 2.5 }, { duration: 1.5 }]) // thisWeekTime
      .mockResolvedValueOnce([{ duration: 3.0 }]) // lastWeekTime
      .mockResolvedValue([]); // dailyData time entries

    mockPrisma.task.groupBy.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/reports/weekly"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary.tasksCompleted).toBe(5);
    expect(body.summary.studyHours).toBe(4);
    expect(body.summary.tasksChange).toBe(2);
    expect(body.summary.hoursChange).toBe(1);
  });

  test("dailyDataが7日分あること", async () => {
    mockPrisma.task.count.mockResolvedValue(0);
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    mockPrisma.task.groupBy.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/reports/weekly"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.dailyData).toHaveLength(7);
    for (const day of body.dailyData) {
      expect(day.date).toBeDefined();
      expect(typeof day.tasks).toBe("number");
      expect(typeof day.hours).toBe("number");
    }
  });

  test("科目別データを返すこと", async () => {
    mockPrisma.task.count.mockResolvedValue(0);
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    mockPrisma.task.groupBy.mockResolvedValue([
      { subject: "Math", _count: 5 },
      { subject: "Science", _count: 3 },
    ]);

    const res = await app.handle(
      new Request("http://localhost/reports/weekly"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.subjectBreakdown).toHaveLength(2);
    expect(body.subjectBreakdown[0].subject).toBe("Math");
    expect(body.subjectBreakdown[0].count).toBe(5);
  });

  test("データがない場合もエラーにならないこと", async () => {
    mockPrisma.task.count.mockResolvedValue(0);
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);
    mockPrisma.task.groupBy.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/reports/weekly"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.summary.tasksCompleted).toBe(0);
    expect(body.summary.studyHours).toBe(0);
    expect(body.summary.tasksChange).toBe(0);
    expect(body.summary.hoursChange).toBe(0);
  });
});
