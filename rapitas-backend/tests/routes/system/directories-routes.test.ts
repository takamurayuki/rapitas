/**
 * Directories Routes テスト
 * ディレクトリブラウズ・お気に入り管理のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  favoriteDirectory: {
    findMany: mock(() => Promise.resolve([])),
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() =>
      Promise.resolve({ id: 1, path: "/test-dir", name: "test-dir" })
    ),
    update: mock(() => Promise.resolve({})),
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

// Mock fs module
mock.module("fs", () => ({
  existsSync: mock((p: string) => p.includes("test-dir")),
  statSync: mock(() => ({ isDirectory: () => true })),
  readdirSync: mock(() => []),
  mkdirSync: mock(() => {}),
}));

const { directoriesRoutes } = await import("../../../routes/system/directories");

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
    .use(directoriesRoutes);
}

describe("GET /directories/favorites", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("お気に入り一覧を返すこと", async () => {
    const favorites = [
      {
        id: 1,
        path: "/test-dir/project1",
        name: "Project 1",
        createdAt: new Date().toISOString(),
      },
      {
        id: 2,
        path: "/test-dir/project2",
        name: "Project 2",
        createdAt: new Date().toISOString(),
      },
    ];
    mockPrisma.favoriteDirectory.findMany.mockResolvedValue(favorites);

    const res = await app.handle(
      new Request("http://localhost/directories/favorites")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
  });

  test("お気に入りが空の場合に空配列を返すこと", async () => {
    mockPrisma.favoriteDirectory.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/directories/favorites")
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe("POST /directories/favorites", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("お気に入りを追加すること", async () => {
    const favorite = {
      id: 1,
      path: "/test-dir/new-project",
      name: "new-project",
      createdAt: new Date().toISOString(),
    };
    mockPrisma.favoriteDirectory.findFirst.mockResolvedValue(null);
    mockPrisma.favoriteDirectory.create.mockResolvedValue(favorite);

    const res = await app.handle(
      new Request("http://localhost/directories/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/test-dir/new-project" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.favoriteDirectory.create).toHaveBeenCalledTimes(1);
  });

  test("既に登録済みのパスの場合にエラーを返すこと", async () => {
    const existing = {
      id: 1,
      path: "/test-dir/existing",
      name: "existing",
    };
    mockPrisma.favoriteDirectory.findFirst.mockResolvedValue(existing);

    const res = await app.handle(
      new Request("http://localhost/directories/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/test-dir/existing" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error).toBeDefined();
    expect(body.existing).toBeDefined();
    expect(mockPrisma.favoriteDirectory.create).not.toHaveBeenCalled();
  });
});

describe("PATCH /directories/favorites/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("お気に入りの名前を更新すること", async () => {
    const updated = {
      id: 1,
      path: "/test-dir/project",
      name: "Updated Name",
    };
    mockPrisma.favoriteDirectory.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request("http://localhost/directories/favorites/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Name" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.favoriteDirectory.update).toHaveBeenCalledTimes(1);
  });
});

describe("DELETE /directories/favorites/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("お気に入りを削除すること", async () => {
    mockPrisma.favoriteDirectory.delete.mockResolvedValue({});

    const res = await app.handle(
      new Request("http://localhost/directories/favorites/1", {
        method: "DELETE",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockPrisma.favoriteDirectory.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  test("削除時にエラーが発生した場合にエラーを返すこと", async () => {
    mockPrisma.favoriteDirectory.delete.mockRejectedValue(
      new Error("Record not found")
    );

    const res = await app.handle(
      new Request("http://localhost/directories/favorites/999", {
        method: "DELETE",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error).toBeDefined();
  });
});

describe("POST /directories/validate", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("有効なパスの場合にvalid:trueを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/directories/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/test-dir/valid" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.valid).toBe(true);
  });

  test("存在しないパスの場合にvalid:falseを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/directories/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/nonexistent/path" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.valid).toBe(false);
    expect(body.error).toBeDefined();
  });
});

describe("POST /directories/create", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("パスが空の場合にエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/directories/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });
});
