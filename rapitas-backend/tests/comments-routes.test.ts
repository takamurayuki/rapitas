/**
 * Comments Routes テスト
 * コメントCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  comment: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  commentLink: {
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  task: {
    findUnique: mock(() => Promise.resolve(null)),
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
mock.module("../services/realtime-service", () => ({
  realtimeService: {
    broadcast: mock(() => {}),
  },
}));
mock.module("../services/cache-service", () => ({
  cacheService: {
    get: mock(() => null),
    set: mock(() => {}),
    delete: mock(() => {}),
  },
}));

const { commentsRoutes } = await import("../routes/social/comments");
const { AppError } = await import("../middleware/error-handler");

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
      if (error instanceof AppError) {
        set.status = error.statusCode;
        return { error: error.message, code: error.code };
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
    .use(commentsRoutes);
}

describe("GET /tasks/:id/comments", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("タスクのコメント一覧を返すこと", async () => {
    const comments = [
      {
        id: 1,
        taskId: 1,
        content: "コメント1",
        parentId: null,
        replies: [],
        linksFrom: [],
        linksTo: [],
      },
      {
        id: 2,
        taskId: 1,
        content: "コメント2",
        parentId: null,
        replies: [],
        linksFrom: [],
        linksTo: [],
      },
    ];
    mockPrisma.comment.findMany.mockResolvedValue(comments);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/comments"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].content).toBe("コメント1");
  });

  test("空配列を返すこと", async () => {
    mockPrisma.comment.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/comments"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  test("無効なタスクIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/tasks/abc/comments"),
    );

    expect(res.status).toBe(400);
  });
});

describe("POST /tasks/:id/comments", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("コメントを作成すること", async () => {
    const created = {
      id: 3,
      taskId: 1,
      content: "新しいコメント",
      parentId: null,
      replies: [],
    };
    mockPrisma.comment.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "新しいコメント" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.content).toBe("新しいコメント");
    expect(mockPrisma.comment.create).toHaveBeenCalledTimes(1);
  });

  test("返信コメントを作成すること", async () => {
    const parentComment = { id: 1, taskId: 1, content: "親コメント" };
    mockPrisma.comment.findUnique.mockResolvedValue(parentComment);

    const created = {
      id: 4,
      taskId: 1,
      content: "返信",
      parentId: 1,
      replies: [],
    };
    mockPrisma.comment.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "返信", parentId: 1 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.parentId).toBe(1);
  });

  test("存在しない親コメントで404を返すこと", async () => {
    mockPrisma.comment.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "返信", parentId: 999 }),
      }),
    );

    expect(res.status).toBe(404);
  });

  test("異なるタスクの親コメントで400を返すこと", async () => {
    const parentComment = { id: 1, taskId: 2, content: "別タスクのコメント" };
    mockPrisma.comment.findUnique.mockResolvedValue(parentComment);

    const res = await app.handle(
      new Request("http://localhost/tasks/1/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "返信", parentId: 1 }),
      }),
    );

    expect(res.status).toBe(400);
  });

  test("内容なしでバリデーションエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/tasks/1/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });

  test("無効なタスクIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/tasks/abc/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "テスト" }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe("PATCH /comments/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("コメントを更新すること", async () => {
    const existing = { id: 1, content: "旧内容" };
    const updated = { id: 1, content: "新内容" };
    mockPrisma.comment.findUnique.mockResolvedValue(existing);
    mockPrisma.comment.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request("http://localhost/comments/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "新内容" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.content).toBe("新内容");
  });

  test("存在しないコメントで404を返すこと", async () => {
    mockPrisma.comment.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/comments/999", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "更新" }),
      }),
    );

    expect(res.status).toBe(404);
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/comments/abc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "更新" }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe("DELETE /comments/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("コメントを削除すること", async () => {
    const existing = { id: 1, content: "削除対象" };
    mockPrisma.comment.findUnique.mockResolvedValue(existing);
    mockPrisma.comment.delete.mockResolvedValue(existing);

    const res = await app.handle(
      new Request("http://localhost/comments/1", { method: "DELETE" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("存在しないコメントで404を返すこと", async () => {
    mockPrisma.comment.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/comments/999", { method: "DELETE" }),
    );

    expect(res.status).toBe(404);
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/comments/abc", { method: "DELETE" }),
    );

    expect(res.status).toBe(400);
  });
});
