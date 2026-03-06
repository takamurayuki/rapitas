/**
 * Debug Logs Routes テスト
 * デバッグログ解析APIのユニットテスト
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

const { debugLogsRouter } = await import("../routes/system/debug-logs");

function createApp() {
  return new Elysia().use(debugLogsRouter);
}

describe("POST /debug-logs/analyze", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test("JSONログコンテンツを解析して結果を返すこと", async () => {
    const content = '{"timestamp":"2024-01-01T00:00:00Z","level":"info","message":"Test message"}';

    const res = await app.handle(
      new Request("http://localhost/debug-logs/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.result).toBeDefined();
    expect(body.detectedType).toBeDefined();
  });

  test("空のコンテンツでバリデーションエラーを返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/debug-logs/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "" }),
      }),
    );

    expect(res.status).toBe(422);
  });
});

describe("POST /debug-logs/detect-type", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test("Syslogコンテンツのタイプを検出すること", async () => {
    const content = "<14>Jan  1 00:00:00 hostname process[1234]: Test message";

    const res = await app.handle(
      new Request("http://localhost/debug-logs/detect-type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.type).toBeDefined();
  });
});

describe("GET /debug-logs/supported-types", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    app = createApp();
  });

  test("サポートされているログタイプの配列を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/debug-logs/supported-types"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.types).toBeDefined();
    expect(Array.isArray(body.types)).toBe(true);
    expect(body.types.length).toBeGreaterThan(0);
    // 各タイプにid, name, descriptionがあること
    for (const type of body.types) {
      expect(type.id).toBeDefined();
      expect(type.name).toBeDefined();
      expect(type.description).toBeDefined();
    }
  });
});
