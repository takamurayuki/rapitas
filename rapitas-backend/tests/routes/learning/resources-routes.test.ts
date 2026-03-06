/**
 * Resources Routes テスト
 * リソースAPIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  resource: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    delete: mock(() => Promise.resolve({})),
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

const { resourcesRoutes } = await import("../../../routes/learning/resources");
const { ValidationError } = await import("../../../middleware/error-handler");

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
      if (error instanceof ValidationError) {
        set.status = error.statusCode;
        return { error: error.message };
      }
      if (code === "VALIDATION") {
        set.status = 422;
        return { error: "Validation error" };
      }
      set.status = 500;
      return {
        error: error instanceof Error ? error.message : "Server error",
      };
    })
    .use(resourcesRoutes);
}

describe("GET /tasks/:id/resources", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("タスクのリソース一覧を返すこと", async () => {
    const resources = [
      { id: 1, title: "ドキュメント", type: "url", taskId: 1 },
      { id: 2, title: "PDF資料", type: "pdf", taskId: 1 },
    ];
    mockPrisma.resource.findMany.mockResolvedValue(resources);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/resources"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  test("空配列を返すこと", async () => {
    mockPrisma.resource.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/resources"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/tasks/abc/resources"),
    );

    expect(res.status).toBe(400);
  });
});

describe("POST /resources", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("URLベースのリソースを作成すること", async () => {
    const created = {
      id: 1,
      title: "MDN Docs",
      type: "url",
      url: "https://developer.mozilla.org",
      taskId: 1,
    };
    mockPrisma.resource.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "MDN Docs",
          type: "url",
          url: "https://developer.mozilla.org",
          taskId: 1,
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe("MDN Docs");
    expect(body.type).toBe("url");
  });

  test("タイトルなしでバリデーションエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "url" }),
      }),
    );

    expect(res.status).toBe(422);
  });

  test("taskIdなしでもリソースを作成できること", async () => {
    const created = { id: 1, title: "一般リソース", type: "url" };
    mockPrisma.resource.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "一般リソース", type: "url" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe("一般リソース");
  });
});

describe("DELETE /resources/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("リソースを削除すること(ファイルなし)", async () => {
    const resource = { id: 1, title: "テスト", filePath: null };
    mockPrisma.resource.findUnique.mockResolvedValue(resource);
    mockPrisma.resource.delete.mockResolvedValue(resource);

    const res = await app.handle(
      new Request("http://localhost/resources/1", { method: "DELETE" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/resources/abc", { method: "DELETE" }),
    );

    expect(res.status).toBe(400);
  });
});
