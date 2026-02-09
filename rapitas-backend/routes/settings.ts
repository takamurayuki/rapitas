/**
 * User Settings API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { getApiKeyForProvider } from "../utils/ai-client";
import { encrypt, decrypt, maskApiKey } from "../utils/encryption";

const PROVIDER_COLUMNS = {
  claude: "claudeApiKeyEncrypted",
  chatgpt: "chatgptApiKeyEncrypted",
  gemini: "geminiApiKeyEncrypted",
} as const;

const PROVIDER_MODEL_COLUMNS = {
  claude: "claudeDefaultModel",
  chatgpt: "chatgptDefaultModel",
  gemini: "geminiDefaultModel",
} as const;

const AVAILABLE_MODELS: Record<string, Array<{ value: string; label: string }>> = {
  claude: [
    { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { value: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
    { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  ],
  chatgpt: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
    { value: "o1", label: "o1" },
    { value: "o1-mini", label: "o1 Mini" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  ],
  gemini: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  ],
};

type ApiProvider = keyof typeof PROVIDER_COLUMNS;

function isValidProvider(provider: string): provider is ApiProvider {
  return provider in PROVIDER_COLUMNS;
}

/**
 * プロバイダ別APIキーバリデーション
 * 各プロバイダのAPIキー形式を検証し、不正なキーの保存を防止する
 */
function validateApiKeyFormat(
  apiKey: string,
  provider: ApiProvider
): { valid: boolean; error?: string } {
  const trimmed = apiKey.trim();

  if (!trimmed) {
    return { valid: false, error: "APIキーを入力してください" };
  }

  if (trimmed.length < 10) {
    return { valid: false, error: "APIキーが短すぎます（10文字以上必要です）" };
  }

  switch (provider) {
    case "claude":
      if (!trimmed.startsWith("sk-ant-api")) {
        return {
          valid: false,
          error: "Claude APIキーは「sk-ant-api」で始まる必要があります",
        };
      }
      break;
    case "chatgpt":
      if (!trimmed.startsWith("sk-")) {
        return {
          valid: false,
          error: "OpenAI APIキーは「sk-」で始まる必要があります",
        };
      }
      // Claude APIキーとの誤入力を防止
      if (trimmed.startsWith("sk-ant-api")) {
        return {
          valid: false,
          error: "これはClaude APIキーです。OpenAI APIキーを入力してください",
        };
      }
      break;
    case "gemini":
      if (!trimmed.startsWith("AIza")) {
        return {
          valid: false,
          error: "Gemini APIキーは「AIza」で始まる必要があります",
        };
      }
      break;
  }

  return { valid: true };
}

export const settingsRoutes = new Elysia({ prefix: "/settings" })
  // Get settings (create if not exists)
  .get("/", async () => {
    let settings = await prisma.userSettings.findFirst();
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {},
      });
    }
    const claudeApiKey = await getApiKeyForProvider("claude");
    const apiKeyConfigured = !!claudeApiKey;

    // ChatGPT/Gemini APIキーの設定状態を判定
    const chatgptConfigured = !!settings.chatgptApiKeyEncrypted;
    const geminiConfigured = !!settings.geminiApiKeyEncrypted;

    return {
      ...settings,
      claudeApiKeyConfigured: apiKeyConfigured,
      chatgptApiKeyConfigured: chatgptConfigured,
      geminiApiKeyConfigured: geminiConfigured,
      claudeApiKeyEncrypted: undefined,
      chatgptApiKeyEncrypted: undefined,
      geminiApiKeyEncrypted: undefined,
      claudeDefaultModel: settings.claudeDefaultModel,
      chatgptDefaultModel: settings.chatgptDefaultModel,
      geminiDefaultModel: settings.geminiDefaultModel,
      defaultAiProvider: settings.defaultAiProvider,
    };
  })

  // Update settings
  .patch(
    "/",
    async ({ body, set }: {
      body: {
        developerModeDefault?: boolean;
        aiTaskAnalysisDefault?: boolean;
        autoResumeInterruptedTasks?: boolean;
        autoExecuteAfterCreate?: boolean;
        autoGenerateTitle?: boolean;
        defaultAiProvider?: string;
      };
      set: { status?: number };
    }) => {
      const { developerModeDefault, aiTaskAnalysisDefault, autoResumeInterruptedTasks, autoExecuteAfterCreate, autoGenerateTitle, defaultAiProvider } = body;

      try {
        let settings = await prisma.userSettings.findFirst();
        if (!settings) {
          settings = await prisma.userSettings.create({
            data: {
              developerModeDefault: developerModeDefault ?? false,
              aiTaskAnalysisDefault: aiTaskAnalysisDefault ?? false,
              autoResumeInterruptedTasks: autoResumeInterruptedTasks ?? false,
              autoExecuteAfterCreate: autoExecuteAfterCreate ?? false,
              autoGenerateTitle: autoGenerateTitle ?? false,
            },
          });
        } else {
          settings = await prisma.userSettings.update({
            where: { id: settings.id },
            data: {
              ...(developerModeDefault !== undefined && { developerModeDefault }),
              ...(aiTaskAnalysisDefault !== undefined && { aiTaskAnalysisDefault }),
              ...(autoResumeInterruptedTasks !== undefined && { autoResumeInterruptedTasks }),
              ...(autoExecuteAfterCreate !== undefined && { autoExecuteAfterCreate }),
              ...(autoGenerateTitle !== undefined && { autoGenerateTitle }),
              ...(defaultAiProvider !== undefined && { defaultAiProvider }),
            },
          });
        }

        return settings;
      } catch (error: unknown) {
        console.error("Settings update error:", error);
        set.status = 500;
        return {
          error: "設定の保存に失敗しました",
          message: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
    {
      body: t.Object({
        developerModeDefault: t.Optional(t.Boolean()),
        aiTaskAnalysisDefault: t.Optional(t.Boolean()),
        autoResumeInterruptedTasks: t.Optional(t.Boolean()),
        autoExecuteAfterCreate: t.Optional(t.Boolean()),
        autoGenerateTitle: t.Optional(t.Boolean()),
        defaultAiProvider: t.Optional(t.String()),
      }),
    }
  )

  // Get API status
  .get("/api-status", async () => {
    const claudeApiKey = await getApiKeyForProvider("claude");
    return {
      claudeApiKeyConfigured: !!claudeApiKey,
    };
  })

  // Get API key status for a specific provider
  .get("/api-key", async ({ query }) => {
    const provider = (query.provider as string) || "claude";

    if (!isValidProvider(provider)) {
      return { configured: false, maskedKey: null, provider };
    }

    const settings = await prisma.userSettings.findFirst();
    if (!settings) {
      return { configured: false, maskedKey: null, provider };
    }

    const column = PROVIDER_COLUMNS[provider];
    const encryptedKey = settings[column];

    if (!encryptedKey) {
      // Fallback to env var for Claude
      if (provider === "claude" && process.env.CLAUDE_API_KEY) {
        return {
          configured: true,
          maskedKey: maskApiKey(process.env.CLAUDE_API_KEY),
          provider,
          source: "env",
        };
      }
      return { configured: false, maskedKey: null, provider };
    }

    try {
      const decrypted = decrypt(encryptedKey);
      return {
        configured: true,
        maskedKey: maskApiKey(decrypted),
        provider,
        source: "db",
      };
    } catch {
      return { configured: false, maskedKey: null, provider };
    }
  })

  // Get all providers' API key status
  .get("/api-keys", async () => {
    const settings = await prisma.userSettings.findFirst();
    const providers = Object.keys(PROVIDER_COLUMNS) as ApiProvider[];

    const result: Record<string, { configured: boolean; maskedKey: string | null }> = {};

    for (const provider of providers) {
      const column = PROVIDER_COLUMNS[provider];
      const encryptedKey = settings?.[column];

      if (encryptedKey) {
        try {
          const decrypted = decrypt(encryptedKey);
          result[provider] = { configured: true, maskedKey: maskApiKey(decrypted) };
        } catch {
          result[provider] = { configured: false, maskedKey: null };
        }
      } else if (provider === "claude" && process.env.CLAUDE_API_KEY) {
        result[provider] = {
          configured: true,
          maskedKey: maskApiKey(process.env.CLAUDE_API_KEY),
        };
      } else {
        result[provider] = { configured: false, maskedKey: null };
      }
    }

    return result;
  })

  // Save API key for a specific provider
  .post(
    "/api-key",
    async ({ body, set }) => {
      const { apiKey, provider = "claude" } = body;

      if (!isValidProvider(provider)) {
        set.status = 400;
        return { error: `無効なプロバイダです: ${provider}` };
      }

      // プロバイダ別のAPIキー形式バリデーション
      const validation = validateApiKeyFormat(apiKey, provider);
      if (!validation.valid) {
        set.status = 400;
        return { error: validation.error };
      }

      const column = PROVIDER_COLUMNS[provider];
      const encrypted = encrypt(apiKey.trim());

      // upsertで安全に保存（他プロバイダのキーを上書きしない）
      const existing = await prisma.userSettings.findFirst();
      if (existing) {
        await prisma.userSettings.update({
          where: { id: existing.id },
          data: { [column]: encrypted },
        });
      } else {
        await prisma.userSettings.create({
          data: { [column]: encrypted },
        });
      }

      return {
        maskedKey: maskApiKey(apiKey.trim()),
        provider,
      };
    },
    {
      body: t.Object({
        apiKey: t.String({ minLength: 1 }),
        provider: t.Optional(t.String()),
      }),
    }
  )

  // Validate API key format for a specific provider
  .post(
    "/api-key/validate",
    async ({ body, set }) => {
      const { apiKey, provider = "claude" } = body;

      if (!isValidProvider(provider)) {
        set.status = 400;
        return { valid: false, error: `無効なプロバイダです: ${provider}` };
      }

      const validation = validateApiKeyFormat(apiKey, provider);
      return validation;
    },
    {
      body: t.Object({
        apiKey: t.String(),
        provider: t.Optional(t.String()),
      }),
    }
  )

  // Delete API key for a specific provider
  .delete("/api-key", async ({ query }) => {
    const provider = (query.provider as string) || "claude";

    if (!isValidProvider(provider)) {
      throw new Error(`Invalid provider: ${provider}`);
    }

    const column = PROVIDER_COLUMNS[provider];
    const settings = await prisma.userSettings.findFirst();

    if (settings) {
      await prisma.userSettings.update({
        where: { id: settings.id },
        data: { [column]: null },
      });
    }

    return { success: true, provider };
  })

  // Get available models for all providers
  .get("/models", () => {
    return AVAILABLE_MODELS;
  })

  // Get default model for a specific provider
  .get("/model", async ({ query }) => {
    const provider = (query.provider as string) || "claude";

    if (!isValidProvider(provider)) {
      return { provider, model: null };
    }

    const settings = await prisma.userSettings.findFirst();
    if (!settings) {
      return { provider, model: null };
    }

    const column = PROVIDER_MODEL_COLUMNS[provider];
    return { provider, model: settings[column] };
  })

  // Save default model for a specific provider
  .post(
    "/model",
    async ({ body, set }) => {
      const { model, provider = "claude" } = body;

      if (!isValidProvider(provider)) {
        set.status = 400;
        return { error: `無効なプロバイダです: ${provider}` };
      }

      // モデルIDのバリデーション
      const providerModels = AVAILABLE_MODELS[provider];
      if (providerModels && model) {
        const validModels = providerModels.map((m) => m.value);
        if (!validModels.includes(model)) {
          set.status = 400;
          return { error: `無効なモデルです: ${model}` };
        }
      }

      const column = PROVIDER_MODEL_COLUMNS[provider];
      const existing = await prisma.userSettings.findFirst();
      if (existing) {
        await prisma.userSettings.update({
          where: { id: existing.id },
          data: { [column]: model || null },
        });
      } else {
        await prisma.userSettings.create({
          data: { [column]: model || null },
        });
      }

      return { provider, model };
    },
    {
      body: t.Object({
        model: t.Optional(t.String()),
        provider: t.Optional(t.String()),
      }),
    }
  );
