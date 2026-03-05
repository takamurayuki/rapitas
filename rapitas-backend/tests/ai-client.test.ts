/**
 * AI Client テスト
 * マルチプロバイダーAIクライアントのテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";

const mockSettings = {
  claudeApiKeyEncrypted: null as string | null,
  chatgptApiKeyEncrypted: null as string | null,
  geminiApiKeyEncrypted: null as string | null,
  claudeDefaultModel: null as string | null,
  chatgptDefaultModel: null as string | null,
  geminiDefaultModel: null as string | null,
  defaultAiProvider: null as string | null,
};

const mockPrisma = {
  userSettings: {
    findFirst: mock(() => Promise.resolve(mockSettings)),
  },
};

mock.module("../config/database", () => ({ prisma: mockPrisma }));
mock.module("../config/logger", () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const mockDecrypt = mock((val: string) => val);
mock.module("../utils/encryption", () => ({
  decrypt: mockDecrypt,
  encrypt: mock((val: string) => `encrypted:${val}`),
  maskApiKey: mock((val: string) => `${val.slice(0, 4)}...`),
}));

const {
  getApiKeyForProvider,
  getDefaultModel,
  getDefaultProvider,
  isAnyApiKeyConfigured,
  getConfiguredProviders,
  sendAIMessage,
  sendAIMessageStream,
} = await import("../utils/ai-client");

describe("getApiKeyForProvider", () => {
  beforeEach(() => {
    mockPrisma.userSettings.findFirst.mockReset();
    mockPrisma.userSettings.findFirst.mockResolvedValue(mockSettings);
    mockDecrypt.mockReset();
    mockDecrypt.mockImplementation((val: string) => val);
    mockSettings.claudeApiKeyEncrypted = null;
    mockSettings.chatgptApiKeyEncrypted = null;
    mockSettings.geminiApiKeyEncrypted = null;
    delete (process.env as any).CLAUDE_API_KEY;
  });

  test("DBに保存されたAPIキーを復号して返すこと（Claude）", async () => {
    mockSettings.claudeApiKeyEncrypted = "encrypted-key";
    mockDecrypt.mockReturnValue("sk-ant-api03-validkeylongenoughfor10chars");
    const key = await getApiKeyForProvider("claude");
    expect(key).toBe("sk-ant-api03-validkeylongenoughfor10chars");
  });

  test("DBに保存されたAPIキーを復号して返すこと（ChatGPT）", async () => {
    mockSettings.chatgptApiKeyEncrypted = "encrypted-key";
    mockDecrypt.mockReturnValue("sk-validkeylongenoughfor10charss");
    const key = await getApiKeyForProvider("chatgpt");
    expect(key).toBe("sk-validkeylongenoughfor10charss");
  });

  test("DBに保存されたAPIキーを復号して返すこと（Gemini）", async () => {
    const geminiKey = "AIzaSyValidGeminiKeyLong";
    mockSettings.geminiApiKeyEncrypted = "encrypted-key";
    mockDecrypt.mockReturnValue(geminiKey);
    const key = await getApiKeyForProvider("gemini");
    expect(key).toBe(geminiKey);
  });

  test("DBにキーがなくClaude環境変数がある場合フォールバックすること", async () => {
    mockSettings.claudeApiKeyEncrypted = null;
    process.env.CLAUDE_API_KEY = "sk-ant-api03-envkeythatislongenough";
    const key = await getApiKeyForProvider("claude");
    expect(key).toBe("sk-ant-api03-envkeythatislongenough");
  });

  test("ChatGPTは環境変数フォールバックしないこと", async () => {
    mockSettings.chatgptApiKeyEncrypted = null;
    const key = await getApiKeyForProvider("chatgpt");
    expect(key).toBeNull();
  });

  test("設定がない場合nullを返すこと", async () => {
    mockPrisma.userSettings.findFirst.mockResolvedValue(null);
    const key = await getApiKeyForProvider("claude");
    // env is not set either
    expect(key).toBeNull();
  });

  test("復号エラー時にnullを返すこと", async () => {
    mockSettings.claudeApiKeyEncrypted = "bad-encrypted";
    mockDecrypt.mockImplementation(() => { throw new Error("decrypt error"); });
    const key = await getApiKeyForProvider("claude");
    expect(key).toBeNull();
  });

  test("不正なフォーマットのキーはフォールバックすること", async () => {
    mockSettings.claudeApiKeyEncrypted = "encrypted";
    mockDecrypt.mockReturnValue("invalid-prefix-key-that-is-long");
    const key = await getApiKeyForProvider("claude");
    // Falls back to env, but env not set
    expect(key).toBeNull();
  });
});

describe("getDefaultModel", () => {
  beforeEach(() => {
    mockPrisma.userSettings.findFirst.mockReset();
    mockPrisma.userSettings.findFirst.mockResolvedValue(mockSettings);
    mockSettings.claudeDefaultModel = null;
    mockSettings.chatgptDefaultModel = null;
    mockSettings.geminiDefaultModel = null;
  });

  test("DBのカスタムモデルを返すこと", async () => {
    mockSettings.claudeDefaultModel = "claude-3-opus";
    const model = await getDefaultModel("claude");
    expect(model).toBe("claude-3-opus");
  });

  test("DBにモデルがない場合デフォルトを返すこと", async () => {
    const model = await getDefaultModel("claude");
    expect(model).toBe("claude-sonnet-4-20250514");
  });

  test("ChatGPTのデフォルトモデルを返すこと", async () => {
    const model = await getDefaultModel("chatgpt");
    expect(model).toBe("gpt-4o");
  });

  test("Geminiのデフォルトモデルを返すこと", async () => {
    const model = await getDefaultModel("gemini");
    expect(model).toBe("gemini-2.5-flash");
  });
});

describe("getDefaultProvider", () => {
  beforeEach(() => {
    mockPrisma.userSettings.findFirst.mockReset();
    mockPrisma.userSettings.findFirst.mockResolvedValue(mockSettings);
    mockSettings.defaultAiProvider = null;
  });

  test("DBのデフォルトプロバイダーを返すこと", async () => {
    mockSettings.defaultAiProvider = "chatgpt";
    const provider = await getDefaultProvider();
    expect(provider).toBe("chatgpt");
  });

  test("DBに設定がない場合claudeを返すこと", async () => {
    const provider = await getDefaultProvider();
    expect(provider).toBe("claude");
  });
});

describe("sendAIMessage", () => {
  beforeEach(() => {
    mockPrisma.userSettings.findFirst.mockReset();
    mockPrisma.userSettings.findFirst.mockResolvedValue(mockSettings);
    mockSettings.claudeApiKeyEncrypted = null;
  });

  test("APIキーが未設定の場合エラーを投げること", async () => {
    try {
      await sendAIMessage({
        messages: [{ role: "user", content: "hello" }],
        provider: "claude",
      });
      expect(true).toBe(false); // should not reach
    } catch (e: any) {
      expect(e.message).toContain("APIキーが設定されていません");
    }
  });

  test("未対応プロバイダーの場合エラーを投げること", async () => {
    try {
      await sendAIMessage({
        messages: [{ role: "user", content: "hello" }],
        provider: "unknown" as any,
      });
      expect(true).toBe(false);
    } catch (e: any) {
      // unknown provider has no API key mapping → throws key not configured or unsupported error
      expect(e.message).toBeTruthy();
    }
  });
});

describe("sendAIMessageStream", () => {
  beforeEach(() => {
    mockPrisma.userSettings.findFirst.mockReset();
    mockPrisma.userSettings.findFirst.mockResolvedValue(mockSettings);
    mockSettings.claudeApiKeyEncrypted = null;
  });

  test("APIキーが未設定の場合エラーを投げること", async () => {
    try {
      await sendAIMessageStream({
        messages: [{ role: "user", content: "hello" }],
        provider: "claude",
      });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e.message).toContain("APIキーが設定されていません");
    }
  });
});
