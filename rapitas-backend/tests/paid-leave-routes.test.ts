/**
 * Paid Leave Routes テスト
 * 有給休暇管理操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  paidLeaveBalance: {
    findUnique: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
    upsert: mock(() => Promise.resolve({ id: 1 })),
  },
  scheduleEvent: {
    findMany: mock(() => Promise.resolve([])),
  },
};

// paid-leave.ts creates its own PrismaClient, so we mock @prisma/client
mock.module("@prisma/client", () => ({
  PrismaClient: class {
    paidLeaveBalance = mockPrisma.paidLeaveBalance;
    scheduleEvent = mockPrisma.scheduleEvent;
  },
}));
mock.module("../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module("../utils/response", () => ({
  createResponse: (data: unknown) => ({ success: true, data }),
  createErrorResponse: (error: string) => ({ success: false, error }),
}));

const { paidLeaveRoutes } = await import(
  "../routes/lifestyle/paid-leave"
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
    .use(paidLeaveRoutes);
}

describe("GET /paid-leave/balance", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("有給残日数を返すこと（既存バランスあり）", async () => {
    const balance = {
      id: 1,
      userId: "default",
      fiscalYear: 2025,
      totalDays: 20,
      usedDays: 5,
      remainingDays: 15,
      carryOverDays: 0,
    };
    mockPrisma.paidLeaveBalance.findUnique.mockResolvedValue(balance);
    mockPrisma.scheduleEvent.findMany.mockResolvedValue([]);
    mockPrisma.paidLeaveBalance.update.mockResolvedValue({
      ...balance,
      usedDays: 0,
      remainingDays: 20,
    });

    const res = await app.handle(
      new Request("http://localhost/paid-leave/balance"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
  });

  test("バランスが存在しない場合に新規作成すること", async () => {
    mockPrisma.paidLeaveBalance.findUnique.mockResolvedValue(null);
    mockPrisma.scheduleEvent.findMany.mockResolvedValue([]);
    const created = {
      id: 1,
      userId: "default",
      totalDays: 20,
      usedDays: 0,
      remainingDays: 20,
    };
    mockPrisma.paidLeaveBalance.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/paid-leave/balance"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe("PUT /paid-leave/balance", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("有給残日数を更新すること", async () => {
    const balance = {
      id: 1,
      userId: "default",
      totalDays: 25,
      usedDays: 0,
      remainingDays: 25,
      carryOverDays: 5,
    };
    mockPrisma.paidLeaveBalance.upsert.mockResolvedValue(balance);
    mockPrisma.scheduleEvent.findMany.mockResolvedValue([]);
    mockPrisma.paidLeaveBalance.update.mockResolvedValue({
      ...balance,
      remainingDays: 30,
    });

    const res = await app.handle(
      new Request("http://localhost/paid-leave/balance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totalDays: 25, carryOverDays: 5 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe("GET /paid-leave/history", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("有給申請履歴を返すこと", async () => {
    const events = [
      {
        id: 1,
        userId: "default",
        type: "PAID_LEAVE",
        title: "有給休暇",
        startAt: new Date("2025-12-01"),
        endAt: new Date("2025-12-01"),
        isAllDay: true,
      },
    ];
    mockPrisma.scheduleEvent.findMany.mockResolvedValue(events);

    const res = await app.handle(
      new Request("http://localhost/paid-leave/history"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  test("履歴が空の場合に空配列を返すこと", async () => {
    mockPrisma.scheduleEvent.findMany.mockResolvedValue([]);

    const res = await app.handle(
      new Request("http://localhost/paid-leave/history"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });
});
