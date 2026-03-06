/**
 * Themes Routes テスト
 * テーマCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  theme: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    updateMany: mock(() => Promise.resolve({ count: 0 })),
    delete: mock(() => Promise.resolve({})),
  },
  category: {
    findFirst: mock(() => Promise.resolve(null)),
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

const { themesRoutes } = await import("../../../routes/organization/themes");
const { AppError } = await import("../../../middleware/error-handler");

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
    .use(themesRoutes);
}

describe("GET /themes", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("全テーマを返すこと", async () => {
    const themes = [
      { id: 1, name: "React", category: null, _count: { tasks: 5 } },
      { id: 2, name: "TypeScript", category: null, _count: { tasks: 3 } },
    ];
    mockPrisma.theme.findMany.mockResolvedValue(themes);

    const res = await app.handle(new Request("http://localhost/themes"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].name).toBe("React");
  });

  test("空配列を返すこと", async () => {
    mockPrisma.theme.findMany.mockResolvedValue([]);

    const res = await app.handle(new Request("http://localhost/themes"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe("GET /themes/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("IDでテーマを取得すること", async () => {
    const theme = {
      id: 1,
      name: "React",
      category: { id: 1, name: "開発" },
      tasks: [],
    };
    mockPrisma.theme.findUnique.mockResolvedValue(theme);

    const res = await app.handle(new Request("http://localhost/themes/1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.name).toBe("React");
  });

  test("存在しないIDで404を返すこと", async () => {
    mockPrisma.theme.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/themes/999"),
    );

    expect(res.status).toBe(404);
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/themes/abc"),
    );

    expect(res.status).toBe(400);
  });
});

describe("POST /themes", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("テーマを作成すること", async () => {
    const created = {
      id: 3,
      name: "Vue",
      categoryId: 1,
      category: { id: 1, name: "開発" },
    };
    mockPrisma.theme.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Vue", categoryId: 1 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("Vue");
    expect(mockPrisma.theme.create).toHaveBeenCalledTimes(1);
  });

  test("名前なしでバリデーションエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe("PATCH /themes/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("テーマを更新すること", async () => {
    const existing = { id: 1, name: "旧名前", categoryId: 1 };
    const updated = {
      id: 1,
      name: "新名前",
      category: { id: 1, name: "開発" },
    };
    mockPrisma.theme.findUnique.mockResolvedValue(existing);
    mockPrisma.theme.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request("http://localhost/themes/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "新名前" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("新名前");
  });

  test("存在しないIDで404を返すこと", async () => {
    mockPrisma.theme.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/themes/999", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "新名前" }),
      }),
    );

    expect(res.status).toBe(404);
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/themes/abc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "新名前" }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe("DELETE /themes/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("テーマを削除すること", async () => {
    const theme = { id: 1, name: "削除対象" };
    mockPrisma.theme.delete.mockResolvedValue(theme);

    const res = await app.handle(
      new Request("http://localhost/themes/1", { method: "DELETE" }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.theme.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/themes/abc", { method: "DELETE" }),
    );

    expect(res.status).toBe(400);
  });
});
