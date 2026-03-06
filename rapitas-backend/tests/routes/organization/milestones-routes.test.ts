/**
 * Milestones Routes テスト
 * マイルストーンCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  milestone: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
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

const { milestonesRoutes } = await import(
  "../../../routes/organization/milestones"
);
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
        set.status = 400;
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
    .use(milestonesRoutes);
}

describe("GET /milestones", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("全マイルストーンを返すこと", async () => {
    const milestones = [
      { id: 1, name: "v1.0", project: { id: 1, name: "Project A" }, _count: { tasks: 3 } },
      { id: 2, name: "v2.0", project: { id: 1, name: "Project A" }, _count: { tasks: 5 } },
    ];
    mockPrisma.milestone.findMany.mockResolvedValue(milestones);

    const res = await app.handle(
      new Request("http://localhost/milestones"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].name).toBe("v1.0");
  });

  test("空配列を返すこと", async () => {
    mockPrisma.milestone.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/milestones"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  test("projectIdでフィルタリングできること", async () => {
    mockPrisma.milestone.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/milestones?projectId=1"),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.milestone.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("GET /milestones/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("IDでマイルストーンを取得すること", async () => {
    const milestone = {
      id: 1,
      name: "v1.0",
      project: { id: 1, name: "Project A" },
      tasks: [],
    };
    mockPrisma.milestone.findUnique.mockResolvedValue(milestone);

    const res = await app.handle(
      new Request("http://localhost/milestones/1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.name).toBe("v1.0");
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/milestones/abc"),
    );

    expect(res.status).toBe(400);
  });
});

describe("POST /milestones", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("マイルストーンを作成すること", async () => {
    const created = {
      id: 1,
      name: "v1.0",
      projectId: 1,
      project: { id: 1, name: "Project A" },
    };
    mockPrisma.milestone.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "v1.0", projectId: 1 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("v1.0");
    expect(mockPrisma.milestone.create).toHaveBeenCalledTimes(1);
  });

  test("名前なしでバリデーションエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe("PATCH /milestones/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("マイルストーンを更新すること", async () => {
    const updated = { id: 1, name: "v2.0" };
    mockPrisma.milestone.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request("http://localhost/milestones/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "v2.0" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("v2.0");
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/milestones/abc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "v2.0" }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe("DELETE /milestones/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("マイルストーンを削除すること", async () => {
    const milestone = { id: 1, name: "v1.0" };
    mockPrisma.milestone.delete.mockResolvedValue(milestone);

    const res = await app.handle(
      new Request("http://localhost/milestones/1", { method: "DELETE" }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.milestone.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/milestones/abc", { method: "DELETE" }),
    );

    expect(res.status).toBe(400);
  });
});
