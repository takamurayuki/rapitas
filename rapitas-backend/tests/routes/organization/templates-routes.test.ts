/**
 * Templates Routes テスト
 * テンプレートCRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  taskTemplate: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  task: {
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
  },
  label: {
    findMany: mock(() => Promise.resolve([])),
  },
  taskLabel: {
    createMany: mock(() => Promise.resolve({ count: 0 })),
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
mock.module("../../../utils/db-helpers", () => ({
  toJsonString: (obj: unknown) => JSON.stringify(obj),
  fromJsonString: (str: string) => {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  },
}));

const { templatesRoutes } = await import(
  "../../../routes/organization/templates"
);

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
    .use(templatesRoutes);
}

describe("GET /templates", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("全テンプレートを返すこと", async () => {
    const templates = [
      { id: 1, name: "バグ修正", category: "development", theme: null },
      { id: 2, name: "新機能", category: "feature", theme: null },
    ];
    mockPrisma.taskTemplate.findMany.mockResolvedValue(templates);

    const res = await app.handle(
      new Request("http://localhost/templates"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].name).toBe("バグ修正");
  });

  test("空配列を返すこと", async () => {
    mockPrisma.taskTemplate.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/templates"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe("GET /templates/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("IDでテンプレートを取得すること", async () => {
    const template = {
      id: 1,
      name: "バグ修正",
      category: "development",
      theme: { id: 1, name: "React", color: "#61dafb", icon: null },
    };
    mockPrisma.taskTemplate.findUnique.mockResolvedValue(template);

    const res = await app.handle(
      new Request("http://localhost/templates/1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(1);
    expect(body.name).toBe("バグ修正");
  });

  test("存在しないIDでnullを返すこと", async () => {
    mockPrisma.taskTemplate.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/templates/999"),
    );

    // Route returns null which results in 200 with empty body
    expect(res.status).toBe(200);
  });
});

describe("POST /templates", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("テンプレートを作成すること", async () => {
    const created = {
      id: 1,
      name: "新規テンプレート",
      category: "development",
      templateData: "{}",
      theme: null,
    };
    mockPrisma.taskTemplate.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "新規テンプレート",
          category: "development",
          templateData: "{}",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("新規テンプレート");
    expect(mockPrisma.taskTemplate.create).toHaveBeenCalledTimes(1);
  });

  test("名前なしでバリデーションエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe("DELETE /templates/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("テンプレートを削除すること", async () => {
    const template = { id: 1, name: "削除対象" };
    mockPrisma.taskTemplate.delete.mockResolvedValue(template);

    const res = await app.handle(
      new Request("http://localhost/templates/1", { method: "DELETE" }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.taskTemplate.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });
});
