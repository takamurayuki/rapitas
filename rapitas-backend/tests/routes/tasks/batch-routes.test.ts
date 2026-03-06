/**
 * Batch Routes テスト
 * バッチリクエスト処理のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  task: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    count: mock(() => Promise.resolve(0)),
    groupBy: mock(() => Promise.resolve([])),
  },
  category: {
    findMany: mock(() => Promise.resolve([])),
  },
  theme: {
    findMany: mock(() => Promise.resolve([])),
  },
};

mock.module("../../../config", () => ({
  prisma: mockPrisma,
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module("../../../config/database", () => ({ prisma: mockPrisma }));
mock.module("../../../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { batchRoutes } = await import("../../../routes/tasks/batch");

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
}

function createApp() {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (code === "VALIDATION") {
        set.status = 422;
        return { error: "Validation error" };
      }
      set.status = 500;
      return {
        error: error instanceof Error ? error.message : "Server error",
      };
    })
    .use(batchRoutes);
}

describe("POST /batch", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("バッチリクエストを処理すること", async () => {
    const categories = [{ id: 1, name: "開発" }];
    mockPrisma.category.findMany.mockResolvedValue(categories);

    const res = await app.handle(
      new Request("http://localhost/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            { id: "req1", method: "GET", url: "/categories" },
          ],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(1);
    expect(body[0].id).toBe("req1");
    expect(body[0].status).toBe(200);
  });

  test("複数リクエストを並列処理すること", async () => {
    mockPrisma.category.findMany.mockResolvedValue([]);
    mockPrisma.theme.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            { id: "req1", method: "GET", url: "/categories" },
            { id: "req2", method: "GET", url: "/themes" },
          ],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.length).toBe(2);
    expect(body[0].id).toBe("req1");
    expect(body[1].id).toBe("req2");
  });

  test("不明なリソースでエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            { id: "req1", method: "GET", url: "/unknown" },
          ],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].status).toBe(500);
    expect(body[0].error).toBeDefined();
  });

  test("リクエストなしでバリデーションエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });

  test("タスクの取得リクエストを処理すること", async () => {
    const tasks = [{ id: 1, title: "テストタスク" }];
    mockPrisma.task.findMany.mockResolvedValue(tasks);

    const res = await app.handle(
      new Request("http://localhost/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            { id: "req1", method: "GET", url: "/tasks" },
          ],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body[0].status).toBe(200);
  });
});
