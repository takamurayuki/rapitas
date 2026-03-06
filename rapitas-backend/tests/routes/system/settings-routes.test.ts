/**
 * Settings Routes テスト
 * ユーザー設定CRUD操作のユニットテスト
 */
import { describe, test, expect, mock, beforeEach } from "bun:test";
import { Elysia } from "elysia";

const mockPrisma = {
  userSettings: {
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
    update: mock(() => Promise.resolve({})),
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
mock.module("../../../utils/encryption", () => ({
  encrypt: (value: string) => `encrypted_${value}`,
  decrypt: (value: string) => value.replace("encrypted_", ""),
  maskApiKey: (value: string) => `${value.slice(0, 4)}****`,
}));
mock.module("../../../utils/ai-client", () => ({
  getApiKeyForProvider: mock(() => Promise.resolve(null)),
}));

const { settingsRoutes } = await import("../../../routes/system/settings");

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
    .use(settingsRoutes);
}

describe("GET /settings", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("設定を返すこと（既存設定あり）", async () => {
    const settings = {
      id: 1,
      developerModeDefault: false,
      aiTaskAnalysisDefault: false,
      claudeApiKeyEncrypted: null,
      chatgptApiKeyEncrypted: null,
      geminiApiKeyEncrypted: null,
      claudeDefaultModel: null,
      chatgptDefaultModel: null,
      geminiDefaultModel: null,
      defaultAiProvider: "claude",
      defaultCategoryId: null,
      activeMode: null,
    };
    mockPrisma.userSettings.findFirst.mockResolvedValue(settings);

    const res = await app.handle(
      new Request("http://localhost/settings"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.claudeApiKeyConfigured).toBe(false);
    expect(body.claudeApiKeyEncrypted).toBeUndefined();
  });

  test("設定が存在しない場合に新規作成すること", async () => {
    mockPrisma.userSettings.findFirst.mockResolvedValue(null);
    const newSettings = {
      id: 1,
      claudeApiKeyEncrypted: null,
      chatgptApiKeyEncrypted: null,
      geminiApiKeyEncrypted: null,
      claudeDefaultModel: null,
      chatgptDefaultModel: null,
      geminiDefaultModel: null,
      defaultAiProvider: "claude",
      defaultCategoryId: null,
      activeMode: null,
    };
    mockPrisma.userSettings.create.mockResolvedValue(newSettings);

    const res = await app.handle(
      new Request("http://localhost/settings"),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.userSettings.create).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /settings", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("設定を更新すること", async () => {
    const existing = { id: 1, developerModeDefault: false };
    const updated = { id: 1, developerModeDefault: true };
    mockPrisma.userSettings.findFirst.mockResolvedValue(existing);
    mockPrisma.userSettings.update.mockResolvedValue(updated);

    const res = await app.handle(
      new Request("http://localhost/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ developerModeDefault: true }),
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.developerModeDefault).toBe(true);
  });

  test("設定が存在しない場合に新規作成すること", async () => {
    mockPrisma.userSettings.findFirst.mockResolvedValue(null);
    const created = { id: 1, developerModeDefault: true };
    mockPrisma.userSettings.create.mockResolvedValue(created);

    const res = await app.handle(
      new Request("http://localhost/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ developerModeDefault: true }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.userSettings.create).toHaveBeenCalledTimes(1);
  });
});

describe("GET /settings/api-keys", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("全プロバイダのAPIキーステータスを返すこと", async () => {
    mockPrisma.userSettings.findFirst.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/settings/api-keys"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("claude");
    expect(body).toHaveProperty("chatgpt");
    expect(body).toHaveProperty("gemini");
  });

  test("設定にAPIキーがある場合にconfigured: trueを返すこと", async () => {
    const settings = {
      id: 1,
      claudeApiKeyEncrypted: "encrypted_sk-ant-api-test",
      chatgptApiKeyEncrypted: null,
      geminiApiKeyEncrypted: null,
    };
    mockPrisma.userSettings.findFirst.mockResolvedValue(settings);

    const res = await app.handle(
      new Request("http://localhost/settings/api-keys"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.claude.configured).toBe(true);
    expect(body.claude.maskedKey).toBeDefined();
    expect(body.chatgpt.configured).toBe(false);
  });
});

describe("GET /settings/models", () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    resetAllMocks();
    app = createApp();
  });

  test("利用可能なモデル一覧を返すこと", async () => {
    mockPrisma.userSettings.findFirst.mockResolvedValue(null);

    const res = await app.handle(
      new Request("http://localhost/settings/models"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveProperty("claude");
    expect(body).toHaveProperty("chatgpt");
    expect(body).toHaveProperty("gemini");
    expect(Array.isArray(body.claude)).toBe(true);
  });
});
