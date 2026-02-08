/**
 * User Settings API Routes
 */
import { Elysia, t } from "elysia";
import { prisma } from "../config/database";
import { isApiKeyConfiguredAsync } from "../services/claude-agent";
import { encrypt, decrypt, maskApiKey } from "../utils/encryption";

const PROVIDER_COLUMNS = {
  claude: "claudeApiKeyEncrypted",
  chatgpt: "chatgptApiKeyEncrypted",
  gemini: "geminiApiKeyEncrypted",
} as const;

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
    const apiKeyConfigured = await isApiKeyConfiguredAsync();

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
    };
  })

  // Update settings
  .patch(
    "/",
    async ({ body }: {
      body: {
        developerModeDefault?: boolean;
        aiTaskAnalysisDefault?: boolean;
        autoResumeInterruptedTasks?: boolean;
      }
    }) => {
      const { developerModeDefault, aiTaskAnalysisDefault, autoResumeInterruptedTasks } = body;

      let settings = await prisma.userSettings.findFirst();
      if (!settings) {
        settings = await prisma.userSettings.create({
          data: {
            developerModeDefault: developerModeDefault ?? false,
            aiTaskAnalysisDefault: aiTaskAnalysisDefault ?? false,
            autoResumeInterruptedTasks: autoResumeInterruptedTasks ?? false,
          },
        });
      } else {
        settings = await prisma.userSettings.update({
          where: { id: settings.id },
          data: {
            ...(developerModeDefault !== undefined && { developerModeDefault }),
            ...(aiTaskAnalysisDefault !== undefined && { aiTaskAnalysisDefault }),
            ...(autoResumeInterruptedTasks !== undefined && { autoResumeInterruptedTasks }),
          },
        });
      }

      return settings;
    },
    {
      body: t.Object({
        developerModeDefault: t.Optional(t.Boolean()),
        aiTaskAnalysisDefault: t.Optional(t.Boolean()),
        autoResumeInterruptedTasks: t.Optional(t.Boolean()),
      }),
    }
  )

  // Get API status
  .get("/api-status", async () => {
    const apiKeyConfigured = await isApiKeyConfiguredAsync();
    return {
      claudeApiKeyConfigured: apiKeyConfigured,
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
  });
