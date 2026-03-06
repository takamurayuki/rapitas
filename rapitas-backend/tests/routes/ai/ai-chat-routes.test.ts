/**
 * AI Chat Routes テスト
 * AIチャットAPIのユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockSendAIMessage = mock(() =>
  Promise.resolve({ content: "AI response", tokensUsed: 100 })
);
const mockSendAIMessageStream = mock(() =>
  Promise.resolve(new ReadableStream())
);
const mockGetConfiguredProviders = mock(() =>
  Promise.resolve([
    { provider: "claude", isConfigured: true },
    { provider: "openai", isConfigured: false },
  ])
);

mock.module("../utils/ai-client", () => ({
  sendAIMessage: mockSendAIMessage,
  sendAIMessageStream: mockSendAIMessageStream,
  getConfiguredProviders: mockGetConfiguredProviders,
  getDefaultProvider: mock(() => Promise.resolve("claude")),
  getDefaultModel: mock(() => Promise.resolve("claude-3-opus")),
  isAnyApiKeyConfigured: mock(() => Promise.resolve(true)),
}));
mock.module("../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { aiChatRoutes } = await import("../routes/ai/ai-chat");

function resetAllMocks() {
  mockSendAIMessage.mockReset();
  mockSendAIMessageStream.mockReset();
  mockGetConfiguredProviders.mockReset();

  mockSendAIMessage.mockResolvedValue({ content: "AI response", tokensUsed: 100 });
  mockSendAIMessageStream.mockResolvedValue(new ReadableStream());
  mockGetConfiguredProviders.mockResolvedValue([
    { provider: "claude", isConfigured: true },
  ]);
}

function createApp() {
  return new Elysia().use(aiChatRoutes);
}

describe("POST /ai/chat", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("メッセージを送信してAI応答を返すこと", async () => {
    mockSendAIMessage.mockResolvedValue({ content: "こんにちは！", tokensUsed: 50 });

    const res = await app.handle(
      new Request("http://localhost/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "こんにちは" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe("こんにちは！");
  });

  test("空メッセージで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  test("メッセージなしで400を返すこと", async () => {
    const res = await app.handle(
      new Request("http://localhost/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBeDefined();
  });

  test("会話履歴付きでメッセージを送信できること", async () => {
    mockSendAIMessage.mockResolvedValue({ content: "了解しました", tokensUsed: 80 });

    const res = await app.handle(
      new Request("http://localhost/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "続けて",
          conversationHistory: [
            { role: "user", content: "こんにちは" },
            { role: "assistant", content: "こんにちは！" },
          ],
        }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("プロバイダーを指定してメッセージを送信できること", async () => {
    mockSendAIMessage.mockResolvedValue({ content: "OpenAI response", tokensUsed: 60 });

    const res = await app.handle(
      new Request("http://localhost/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "テスト", provider: "openai" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  test("AI通信エラー時に500を返すこと", async () => {
    mockSendAIMessage.mockRejectedValue(new Error("API error"));

    const res = await app.handle(
      new Request("http://localhost/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "テスト" }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeDefined();
  });

  test("100,000文字を超えるメッセージで400を返すこと", async () => {
    const longMessage = "a".repeat(100_001);

    const res = await app.handle(
      new Request("http://localhost/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: longMessage }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("長すぎ");
  });
});

describe("GET /ai/providers", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("設定済みプロバイダー一覧を返すこと", async () => {
    mockGetConfiguredProviders.mockResolvedValue([
      { provider: "claude", isConfigured: true },
      { provider: "openai", isConfigured: false },
    ]);

    const res = await app.handle(new Request("http://localhost/ai/providers"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.providers).toBeDefined();
    expect(Array.isArray(body.providers)).toBe(true);
  });
});
