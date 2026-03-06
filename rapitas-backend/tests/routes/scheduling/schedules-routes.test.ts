/**
 * Schedules Routes テスト
 * スケジュールイベントAPIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  scheduleEvent: {
    findMany: mock(() => Promise.resolve([])),
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({ id: 1 })),
    delete: mock(() => Promise.resolve({ id: 1 })),
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
mock.module("../../../services/recurrence-service", () => ({
  parseRRule: mock(() => ({ freq: "WEEKLY", interval: 1 })),
  expandRecurrence: mock(() => []),
  RECURRENCE_PRESETS: [
    { label: "毎日", rule: "FREQ=DAILY" },
    { label: "毎週", rule: "FREQ=WEEKLY" },
  ],
}));

const { schedulesRoutes } = await import("../../../routes/scheduling/schedules");
const { AppError, ValidationError, NotFoundError } = await import(
  "../../../middleware/error-handler"
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
  mockPrisma.scheduleEvent.findMany.mockResolvedValue([]);
  mockPrisma.scheduleEvent.findUnique.mockResolvedValue(null);
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
      return { error: error instanceof Error ? error.message : "Server error" };
    })
    .use(schedulesRoutes);
}

describe("GET /schedules/", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("イベント一覧を返すこと", async () => {
    const events = [
      {
        id: 1,
        title: "Meeting",
        startAt: new Date("2026-03-06T10:00:00Z"),
        endAt: null,
        recurrenceRule: null,
        parentEventId: null,
        isRecurrenceException: false,
        originalDate: null,
        recurrenceEnd: null,
      },
    ];
    mockPrisma.scheduleEvent.findMany.mockResolvedValue(events);

    const res = await app.handle(new Request("http://localhost/schedules/"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test("from/toパラメータでフィルタできること", async () => {
    mockPrisma.scheduleEvent.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/schedules/?from=2026-03-01&to=2026-03-31"),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.scheduleEvent.findMany).toHaveBeenCalled();
  });
});

describe("GET /schedules/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("IDでイベントを取得できること", async () => {
    const event = {
      id: 1,
      title: "Test Event",
      startAt: new Date("2026-03-06T10:00:00Z"),
    };
    mockPrisma.scheduleEvent.findUnique.mockResolvedValue(event);

    const res = await app.handle(new Request("http://localhost/schedules/1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe("Test Event");
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(new Request("http://localhost/schedules/abc"));

    expect(res.status).toBe(400);
  });

  test("存在しないIDで404を返すこと", async () => {
    mockPrisma.scheduleEvent.findUnique.mockResolvedValue(null);

    const res = await app.handle(new Request("http://localhost/schedules/999"));

    expect(res.status).toBe(404);
  });
});

describe("POST /schedules/", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("新しいイベントを作成できること", async () => {
    const created = {
      id: 1,
      title: "New Event",
      startAt: new Date("2026-03-10T09:00:00Z"),
    };
    mockPrisma.scheduleEvent.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/schedules/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "New Event",
          startAt: "2026-03-10T09:00:00Z",
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe("New Event");
    expect(mockPrisma.scheduleEvent.create).toHaveBeenCalledTimes(1);
  });

  test("タイトルなしで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/schedules/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "",
          startAt: "2026-03-10T09:00:00Z",
        }),
      }),
    );

    expect(res.status).toBe(400);
  });

  test("startAtなしで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/schedules/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Event",
        }),
      }),
    );

    expect(res.status).toBe(400);
  });
});

describe("PATCH /schedules/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("イベントを更新できること", async () => {
    const existing = { id: 1, title: "Old Title" };
    const updated = { id: 1, title: "New Title" };
    mockPrisma.scheduleEvent.findUnique.mockResolvedValue(existing);
    mockPrisma.scheduleEvent.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request("http://localhost/schedules/1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Title" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.title).toBe("New Title");
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/schedules/abc", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "test" }),
      }),
    );

    expect(res.status).toBe(400);
  });

  test("存在しないIDで404を返すこと", async () => {
    mockPrisma.scheduleEvent.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/schedules/999", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "test" }),
      }),
    );

    expect(res.status).toBe(404);
  });
});

describe("DELETE /schedules/:id", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("イベントを削除できること", async () => {
    const existing = { id: 1, title: "To Delete" };
    mockPrisma.scheduleEvent.findUnique.mockResolvedValue(existing);
    mockPrisma.scheduleEvent.delete.mockResolvedValue(existing);

    const res = await app.handle(
      new Request("http://localhost/schedules/1", { method: "DELETE" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.id).toBe(1);
  });

  test("無効なIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/schedules/abc", { method: "DELETE" }),
    );

    expect(res.status).toBe(400);
  });

  test("存在しないIDで404を返すこと", async () => {
    mockPrisma.scheduleEvent.findUnique.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/schedules/999", { method: "DELETE" }),
    );

    expect(res.status).toBe(404);
  });
});
