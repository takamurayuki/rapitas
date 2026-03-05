/**
 * Time Entries Routes テスト
 * タスクの時間記録APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  timeEntry: {
    findMany: mock(() => Promise.resolve([])),
    create: mock(() => Promise.resolve({ id: 1 })),
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

const { timeEntriesRoutes } = await import("../routes/scheduling/time-entries");
const { AppError } = await import("../middleware/error-handler");

function resetAllMocks() {
  mockPrisma.timeEntry.findMany.mockReset();
  mockPrisma.timeEntry.create.mockReset();
  mockPrisma.timeEntry.findMany.mockResolvedValue([]);
  mockPrisma.timeEntry.create.mockResolvedValue({ id: 1 });
}

function createApp() {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (error instanceof AppError) {
        set.status = error.statusCode;
        return { error: error.message, code: error.code };
      }
      if (code === "VALIDATION") {
        set.status = 422;
        return { error: "Validation error" };
      }
      set.status = 500;
      return { error: error instanceof Error ? error.message : "Server error" };
    })
    .use(timeEntriesRoutes);
}

describe("GET /tasks/:id/time-entries", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("タスクの時間エントリを取得できること", async () => {
    const entries = [
      {
        id: 1,
        taskId: 1,
        duration: 3600,
        startedAt: new Date("2026-03-06T10:00:00Z"),
        endedAt: new Date("2026-03-06T11:00:00Z"),
      },
    ];
    mockPrisma.timeEntry.findMany.mockResolvedValue(entries);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/time-entries"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  test("空の時間エントリを返すこと", async () => {
    mockPrisma.timeEntry.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/time-entries"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  test("無効なタスクIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/tasks/abc/time-entries"),
    );

    expect(res.status).toBe(400);
  });
});

describe("POST /tasks/:id/time-entries", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("時間エントリを作成できること", async () => {
    const created = {
      id: 1,
      taskId: 1,
      duration: 1800,
      startedAt: new Date("2026-03-06T10:00:00Z"),
      endedAt: new Date("2026-03-06T10:30:00Z"),
    };
    mockPrisma.timeEntry.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duration: 1800,
          startedAt: "2026-03-06T10:00:00Z",
          endedAt: "2026-03-06T10:30:00Z",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.duration).toBe(1800);
    expect(mockPrisma.timeEntry.create).toHaveBeenCalledTimes(1);
  });

  test("noteを含む時間エントリを作成できること", async () => {
    const created = {
      id: 2,
      taskId: 1,
      duration: 3600,
      note: "Focused study",
      startedAt: new Date("2026-03-06T14:00:00Z"),
      endedAt: new Date("2026-03-06T15:00:00Z"),
    };
    mockPrisma.timeEntry.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duration: 3600,
          startedAt: "2026-03-06T14:00:00Z",
          endedAt: "2026-03-06T15:00:00Z",
          note: "Focused study",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.note).toBe("Focused study");
  });

  test("無効なタスクIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/tasks/abc/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duration: 1800,
          startedAt: "2026-03-06T10:00:00Z",
          endedAt: "2026-03-06T10:30:00Z",
        }),
      }),
    );

    expect(res.status).toBe(400);
  });

  test("必須フィールドなしでバリデーションエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/tasks/1/time-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });
});
