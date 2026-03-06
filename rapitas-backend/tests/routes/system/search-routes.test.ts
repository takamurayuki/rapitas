/**
 * Search Routes テスト
 * 横断検索APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([])),
  },
  comment: {
    findMany: mock(() => Promise.resolve([])),
  },
  resource: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module("../../../config/database", () => ({ prisma: mockPrisma }));
mock.module("../../../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { searchRoutes } = await import("../../../routes/system/search");

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
  mockPrisma.task.findMany.mockResolvedValue([]);
  mockPrisma.comment.findMany.mockResolvedValue([]);
  mockPrisma.resource.findMany.mockResolvedValue([]);
}

function createApp() {
  return new Elysia().use(searchRoutes);
}

describe("GET /search/", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("検索結果を返すこと", async () => {
    const tasks = [
      {
        id: 1,
        title: "Test Task",
        description: "A test description",
        status: "todo",
        priority: "medium",
        dueDate: null,
        createdAt: new Date("2026-03-01"),
        updatedAt: new Date("2026-03-01"),
        theme: null,
        taskLabels: [],
      },
    ];
    mockPrisma.task.findMany.mockResolvedValue(tasks);

    const res = await app.handle(
      new Request("http://localhost/search/?q=Test"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.results).toBeDefined();
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.query).toBe("Test");
  });

  test("クエリなしで400を返すこと", async () => {
    const res = await app.handle(new Request("http://localhost/search/"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  test("空のクエリで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/search/?q="),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  test("長すぎるクエリで400を返すこと", async () => {
    const longQuery = "a".repeat(501);
    const res = await app.handle(
      new Request(`http://localhost/search/?q=${longQuery}`),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  test("typeパラメータでフィルタできること", async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/search/?q=test&type=task"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // taskのみ検索するので、commentやresourceは呼ばれないはず
    expect(mockPrisma.task.findMany).toHaveBeenCalled();
  });

  test("limitとoffsetが機能すること", async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/search/?q=test&limit=5&offset=10"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.limit).toBe(5);
    expect(body.offset).toBe(10);
  });

  test("コメント検索結果を含むこと", async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.comment.findMany.mockResolvedValue([
      {
        id: 1,
        content: "This is a test comment",
        taskId: 1,
        task: { id: 1, title: "Related Task" },
        createdAt: new Date("2026-03-01"),
        updatedAt: new Date("2026-03-01"),
      },
    ]);
    mockPrisma.resource.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/search/?q=test"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.results.some((r: { type: string }) => r.type === "comment")).toBe(true);
  });

  test("DBエラー時に500を返すこと", async () => {
    mockPrisma.task.findMany.mockRejectedValue(new Error("DB error"));

    const res = await app.handle(
      new Request("http://localhost/search/?q=test"),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });
});

describe("GET /search/suggest", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("サジェストを返すこと", async () => {
    const tasks = [
      { id: 1, title: "Test Task", status: "todo" },
      { id: 2, title: "Testing", status: "in_progress" },
    ];
    mockPrisma.task.findMany.mockResolvedValue(tasks);

    const res = await app.handle(
      new Request("http://localhost/search/suggest?q=Test"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.suggestions).toHaveLength(2);
    expect(body.suggestions[0].type).toBe("task");
  });

  test("空クエリで空のサジェストを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/search/suggest?q="),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.suggestions).toEqual([]);
  });

  test("クエリなしで空のサジェストを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/search/suggest"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.suggestions).toEqual([]);
  });

  test("DBエラー時に500を返すこと", async () => {
    mockPrisma.task.findMany.mockRejectedValue(new Error("DB error"));

    const res = await app.handle(
      new Request("http://localhost/search/suggest?q=test"),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });
});
