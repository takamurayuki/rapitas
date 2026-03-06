/**
 * Habits Routes テスト
 * 習慣CRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  habit: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    delete: mock(() => Promise.resolve({})),
  },
  habitLog: {
    findMany: mock(() => Promise.resolve([])),
    upsert: mock(() => Promise.resolve({ id: 1, count: 1 })),
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
mock.module("../../../services/achievement-checker", () => ({
  checkAchievements: mock(() => Promise.resolve()),
}));

const { habitsRoutes } = await import("../../../routes/lifestyle/habits");

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
    .use(habitsRoutes);
}

describe("GET /habits", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("全習慣を返すこと", async () => {
    const habits = [
      { id: 1, name: "読書", logs: [], _count: { logs: 10 } },
      { id: 2, name: "運動", logs: [], _count: { logs: 5 } },
    ];
    mockPrisma.habit.findMany.mockResolvedValue(habits);

    const res = await app.handle(
      new Request("http://localhost/habits"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].name).toBe("読書");
  });

  test("空配列を返すこと", async () => {
    mockPrisma.habit.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/habits"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });
});

describe("GET /habits/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("IDで習慣を取得すること", async () => {
    const habit = {
      id: 1,
      name: "読書",
      frequency: "daily",
      logs: [],
    };
    mockPrisma.habit.findUnique.mockResolvedValue(habit);
    mockPrisma.habitLog.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/habits/1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("読書");
    expect(body).toHaveProperty("streak");
    expect(body).toHaveProperty("completionRate");
  });

  test("存在しないIDでnullを返すこと", async () => {
    mockPrisma.habit.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/habits/999"),
    );

    // Route returns null which results in 200 with empty body
    expect(res.status).toBe(200);
  });
});

describe("POST /habits", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("習慣を作成すること", async () => {
    const created = { id: 1, name: "瞑想" };
    mockPrisma.habit.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "瞑想" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("瞑想");
    expect(mockPrisma.habit.create).toHaveBeenCalledTimes(1);
  });

  test("名前なしでバリデーションエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe("PATCH /habits/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("習慣を更新すること", async () => {
    const updated = { id: 1, name: "毎日読書" };
    mockPrisma.habit.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request("http://localhost/habits/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "毎日読書" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe("毎日読書");
  });
});

describe("DELETE /habits/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("習慣を削除すること", async () => {
    const habit = { id: 1, name: "削除対象" };
    mockPrisma.habit.delete.mockResolvedValue(habit);

    const res = await app.handle(
      new Request("http://localhost/habits/1", { method: "DELETE" }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.habit.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });
});

describe("POST /habits/:id/log", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("習慣ログを記録すること", async () => {
    const logEntry = { id: 1, habitId: 1, count: 1, date: new Date() };
    mockPrisma.habitLog.upsert.mockResolvedValue(logEntry);

    const res = await app.handle(
      new Request("http://localhost/habits/1/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.count).toBe(1);
    expect(mockPrisma.habitLog.upsert).toHaveBeenCalledTimes(1);
  });
});
