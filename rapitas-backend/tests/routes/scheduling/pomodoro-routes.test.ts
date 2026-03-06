/**
 * Pomodoro Routes テスト
 * ポモドーロタイマーAPIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockGetActiveSession = mock(() => Promise.resolve(null));
const mockStartPomodoro = mock(() => Promise.resolve({ id: 1 }));
const mockPausePomodoro = mock(() => Promise.resolve({ id: 1 }));
const mockResumePomodoro = mock(() => Promise.resolve({ id: 1 }));
const mockCompletePomodoro = mock(() => Promise.resolve({ session: { id: 1 }, completedPomodoros: 1 }));
const mockCancelPomodoro = mock(() => Promise.resolve({ id: 1 }));
const mockGetStatistics = mock(() => Promise.resolve({ totalSessions: 0, totalMinutes: 0 }));
const mockGetHistory = mock(() => Promise.resolve({ sessions: [], total: 0 }));

mock.module("../../../services/pomodoro-service", () => ({
  getActiveSession: mockGetActiveSession,
  startPomodoro: mockStartPomodoro,
  pausePomodoro: mockPausePomodoro,
  resumePomodoro: mockResumePomodoro,
  completePomodoro: mockCompletePomodoro,
  cancelPomodoro: mockCancelPomodoro,
  getStatistics: mockGetStatistics,
  getHistory: mockGetHistory,
}));
mock.module("../../../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { pomodoroRoutes } = await import("../../../routes/scheduling/pomodoro");

function resetAllMocks() {
  mockGetActiveSession.mockReset();
  mockStartPomodoro.mockReset();
  mockPausePomodoro.mockReset();
  mockResumePomodoro.mockReset();
  mockCompletePomodoro.mockReset();
  mockCancelPomodoro.mockReset();
  mockGetStatistics.mockReset();
  mockGetHistory.mockReset();

  mockGetActiveSession.mockResolvedValue(null);
  mockStartPomodoro.mockResolvedValue({ id: 1, status: "active" });
  mockPausePomodoro.mockResolvedValue({ id: 1, status: "paused" });
  mockResumePomodoro.mockResolvedValue({ id: 1, status: "active" });
  mockCompletePomodoro.mockResolvedValue({ session: { id: 1, status: "completed" }, completedPomodoros: 1 });
  mockCancelPomodoro.mockResolvedValue({ id: 1, status: "cancelled" });
  mockGetStatistics.mockResolvedValue({ totalSessions: 5, totalMinutes: 125 });
  mockGetHistory.mockResolvedValue({ sessions: [], total: 0 });
}

function createApp() {
  return new Elysia().use(pomodoroRoutes);
}

describe("GET /pomodoro/active", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("アクティブセッションがない場合、nullを返すこと", async () => {
    mockGetActiveSession.mockResolvedValue(null);

    const res = await app.handle(new Request("http://localhost/pomodoro/active"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.session).toBeNull();
  });

  test("アクティブセッションがある場合、セッションを返すこと", async () => {
    const session = { id: 1, status: "active", duration: 1500, taskId: 1 };
    mockGetActiveSession.mockResolvedValue(session);

    const res = await app.handle(new Request("http://localhost/pomodoro/active"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.session).toEqual(session);
  });

  test("サービスエラー時に500を返すこと", async () => {
    mockGetActiveSession.mockRejectedValue(new Error("DB error"));

    const res = await app.handle(new Request("http://localhost/pomodoro/active"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });
});

describe("POST /pomodoro/start", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("ポモドーロを開始できること", async () => {
    const session = { id: 1, status: "active", duration: 1500 };
    mockStartPomodoro.mockResolvedValue(session);

    const res = await app.handle(
      new Request("http://localhost/pomodoro/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: 1, duration: 1500 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.session).toEqual(session);
  });

  test("bodyなしでも開始できること", async () => {
    const session = { id: 1, status: "active" };
    mockStartPomodoro.mockResolvedValue(session);

    const res = await app.handle(
      new Request("http://localhost/pomodoro/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("サービスエラー時に500を返すこと", async () => {
    mockStartPomodoro.mockRejectedValue(new Error("Already active"));

    const res = await app.handle(
      new Request("http://localhost/pomodoro/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: 1 }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });
});

describe("POST /pomodoro/sessions/:id/pause", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("セッションを一時停止できること", async () => {
    const session = { id: 1, status: "paused" };
    mockPausePomodoro.mockResolvedValue(session);

    const res = await app.handle(
      new Request("http://localhost/pomodoro/sessions/1/pause", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.session).toEqual(session);
  });

  test("無効なセッションIDで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/pomodoro/sessions/abc/pause", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });

  test("サービスエラー時に400を返すこと", async () => {
    mockPausePomodoro.mockRejectedValue(new Error("Session not found"));

    const res = await app.handle(
      new Request("http://localhost/pomodoro/sessions/1/pause", { method: "POST" }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
  });
});

describe("GET /pomodoro/statistics", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("統計情報を取得できること", async () => {
    const stats = { totalSessions: 10, totalMinutes: 250 };
    mockGetStatistics.mockResolvedValue(stats);

    const res = await app.handle(new Request("http://localhost/pomodoro/statistics"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.totalSessions).toBe(10);
  });

  test("日付フィルタ付きで統計情報を取得できること", async () => {
    mockGetStatistics.mockResolvedValue({ totalSessions: 3, totalMinutes: 75 });

    const res = await app.handle(
      new Request("http://localhost/pomodoro/statistics?startDate=2026-01-01&endDate=2026-01-31"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("サービスエラー時に500を返すこと", async () => {
    mockGetStatistics.mockRejectedValue(new Error("DB error"));

    const res = await app.handle(new Request("http://localhost/pomodoro/statistics"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });
});

describe("GET /pomodoro/history", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("履歴を取得できること", async () => {
    const result = { sessions: [{ id: 1, status: "completed" }], total: 1 };
    mockGetHistory.mockResolvedValue(result);

    const res = await app.handle(new Request("http://localhost/pomodoro/history"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.sessions).toHaveLength(1);
  });

  test("limit/offsetパラメータを受け付けること", async () => {
    mockGetHistory.mockResolvedValue({ sessions: [], total: 0 });

    const res = await app.handle(
      new Request("http://localhost/pomodoro/history?limit=10&offset=5"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("サービスエラー時に500を返すこと", async () => {
    mockGetHistory.mockRejectedValue(new Error("DB error"));

    const res = await app.handle(new Request("http://localhost/pomodoro/history"));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });
});
