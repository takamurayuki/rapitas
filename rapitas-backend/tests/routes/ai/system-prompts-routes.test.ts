/**
 * System Prompts Routes テスト
 * システムプロンプトCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  systemPrompt: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
    upsert: mock(() => Promise.resolve({})),
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

const { systemPromptsRoutes } = await import("../routes/ai/system-prompts");

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
  return new Elysia().use(systemPromptsRoutes);
}

describe("GET /system-prompts", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("全システムプロンプトを返すこと", async () => {
    const prompts = [
      { id: 1, key: "task_analysis", name: "タスク分析", category: "analysis" },
      { id: 2, key: "ai_chat_default", name: "AIチャット", category: "chat" },
    ];
    mockPrisma.systemPrompt.findMany.mockResolvedValue(prompts);

    const res = await app.handle(
      new Request("http://localhost/system-prompts"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  test("カテゴリでフィルタできること", async () => {
    const prompts = [
      { id: 1, key: "task_analysis", name: "タスク分析", category: "analysis" },
    ];
    mockPrisma.systemPrompt.findMany.mockResolvedValue(prompts);

    const res = await app.handle(
      new Request("http://localhost/system-prompts?category=analysis"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("空配列を返すこと", async () => {
    mockPrisma.systemPrompt.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/system-prompts"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe("GET /system-prompts/:key", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("キーでシステムプロンプトを取得すること", async () => {
    const prompt = { id: 1, key: "task_analysis", name: "タスク分析", content: "test" };
    mockPrisma.systemPrompt.findUnique.mockResolvedValue(prompt);

    const res = await app.handle(
      new Request("http://localhost/system-prompts/task_analysis"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.key).toBe("task_analysis");
  });

  test("存在しないキーで404を返すこと", async () => {
    mockPrisma.systemPrompt.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/system-prompts/nonexistent"),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
  });
});

describe("POST /system-prompts", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("システムプロンプトを作成すること", async () => {
    const created = {
      id: 1,
      key: "test_key",
      name: "テスト",
      content: "test content",
      category: "general",
      isDefault: false,
    };
    mockPrisma.systemPrompt.findUnique.mockResolvedValue(null);
    mockPrisma.systemPrompt.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/system-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "test_key",
          name: "テスト",
          content: "test content",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.key).toBe("test_key");
  });

  test("必須フィールドなしで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/system-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "test" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  test("重複キーで409を返すこと", async () => {
    mockPrisma.systemPrompt.findUnique.mockResolvedValue({
      id: 1,
      key: "existing_key",
    });

    const res = await app.handle(
      new Request("http://localhost/system-prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "existing_key",
          name: "テスト",
          content: "test",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBeDefined();
  });
});

describe("PATCH /system-prompts/:key", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("システムプロンプトを更新すること", async () => {
    const existing = { id: 1, key: "task_analysis", name: "old" };
    const updated = { id: 1, key: "task_analysis", name: "new" };
    mockPrisma.systemPrompt.findUnique.mockResolvedValue(existing);
    mockPrisma.systemPrompt.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request("http://localhost/system-prompts/task_analysis", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "new" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("new");
  });

  test("存在しないキーで404を返すこと", async () => {
    mockPrisma.systemPrompt.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/system-prompts/nonexistent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "test" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
  });
});

describe("DELETE /system-prompts/:key", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("システムプロンプトを削除すること", async () => {
    const existing = { id: 1, key: "custom_key", isDefault: false };
    mockPrisma.systemPrompt.findUnique.mockResolvedValue(existing);
    mockPrisma.systemPrompt.delete.mockResolvedValue(existing);

    const res = await app.handle(
      new Request("http://localhost/system-prompts/custom_key", {
        method: "DELETE",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("デフォルトプロンプトの削除で400を返すこと", async () => {
    const existing = { id: 1, key: "task_analysis", isDefault: true };
    mockPrisma.systemPrompt.findUnique.mockResolvedValue(existing);

    const res = await app.handle(
      new Request("http://localhost/system-prompts/task_analysis", {
        method: "DELETE",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("デフォルト");
  });

  test("存在しないキーで404を返すこと", async () => {
    mockPrisma.systemPrompt.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/system-prompts/nonexistent", {
        method: "DELETE",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
  });
});

describe("POST /system-prompts/:key/reset", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("デフォルトプロンプトをリセットすること", async () => {
    const reset = {
      key: "task_analysis",
      name: "タスク分析",
      isDefault: true,
      isActive: true,
    };
    mockPrisma.systemPrompt.upsert.mockResolvedValue(reset);

    const res = await app.handle(
      new Request("http://localhost/system-prompts/task_analysis/reset", {
        method: "POST",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.key).toBe("task_analysis");
  });

  test("デフォルト定義にないキーで404を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/system-prompts/nonexistent_key/reset", {
        method: "POST",
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBeDefined();
  });
});

describe("POST /system-prompts/seed", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("デフォルトプロンプトをシードすること", async () => {
    mockPrisma.systemPrompt.findUnique.mockResolvedValue(null);
    mockPrisma.systemPrompt.create.mockResolvedValue({ id: 1 });

    const res = await app.handle(
      new Request("http://localhost/system-prompts/seed", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);
  });

  test("既存プロンプトをスキップすること", async () => {
    mockPrisma.systemPrompt.findUnique.mockResolvedValue({
      id: 1,
      key: "existing",
    });

    const res = await app.handle(
      new Request("http://localhost/system-prompts/seed", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results).toBeDefined();
    // All should be skipped
    for (const result of body.results) {
      expect(result.action).toBe("skipped");
    }
  });
});
