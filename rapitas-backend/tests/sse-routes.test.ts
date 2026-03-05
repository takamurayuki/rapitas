/**
 * SSE Routes テスト
 * Server-Sent Events APIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

// Mock logger
mock.module("../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

// Mock realtime service
const mockRealtimeService = {
  registerClient: mock(() => "mock-client-id"),
  removeClient: mock(() => {}),
  getClientCount: mock(() => 2),
  getClients: mock(() => [{ id: "c1", subscriptions: ["*"] }]),
  registerStreamController: mock(() => {}),
  removeStreamController: mock(() => {}),
  getChannelHistory: mock(() => []),
};

mock.module("../services/realtime-service", () => ({
  realtimeService: mockRealtimeService,
}));

const { sseRoutes } = await import("../routes/system/sse");

function createApp() {
  return new Elysia().use(sseRoutes);
}

function resetAllMocks() {
  mockRealtimeService.registerClient.mockReset();
  mockRealtimeService.removeClient.mockReset();
  mockRealtimeService.getClientCount.mockReset();
  mockRealtimeService.getClients.mockReset();
  mockRealtimeService.registerStreamController.mockReset();
  mockRealtimeService.removeStreamController.mockReset();
  mockRealtimeService.getChannelHistory.mockReset();

  mockRealtimeService.registerClient.mockReturnValue("mock-client-id");
  mockRealtimeService.removeClient.mockReturnValue(undefined);
  mockRealtimeService.getClientCount.mockReturnValue(2);
  mockRealtimeService.getClients.mockReturnValue([
    { id: "c1", subscriptions: ["*"] },
  ]);
  mockRealtimeService.registerStreamController.mockReturnValue(undefined);
  mockRealtimeService.removeStreamController.mockReturnValue(undefined);
  mockRealtimeService.getChannelHistory.mockReturnValue([]);
}

describe("GET /events/status", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("クライアント数とクライアント一覧を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/events/status"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.clientCount).toBe(2);
    expect(body.clients).toBeDefined();
    expect(Array.isArray(body.clients)).toBe(true);
    expect(body.clients).toHaveLength(1);
    expect(body.clients[0].id).toBe("c1");
  });
});

describe("GET /events/stream", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("SSEストリームのContent-Typeヘッダーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/events/stream"),
    );

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });
});

describe("GET /events/subscribe/:channel", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("チャンネルSSEストリームのContent-Typeヘッダーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/events/subscribe/tasks"),
    );

    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
  });
});
