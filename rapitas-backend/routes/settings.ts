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

// Cache for available models with expiration
let modelCache: {
  data: Record<string, Array<{ value: string; label: string }>>;
  expiresAt: number;
} | null = null;

const MODEL_CACHE_DURATION = 60 * 60 * 1000; // 1 hour in milliseconds

// API Response Types
interface ClaudeModelsResponse {
  models: Array<{
    id: string;
    display_name?: string;
  }>;
}

interface OpenAIModelsResponse {
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }>;
}

interface GeminiModelsResponse {
  models: Array<{
    name: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
}

// Fallback models in case dynamic fetching fails
const FALLBACK_MODELS: Record<string, Array<{ value: string; label: string }>> = {
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
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
    { value: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash (Experimental)" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    { value: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash 8B" },
  ],
};

type ApiProvider = keyof typeof PROVIDER_COLUMNS;

function isValidProvider(provider: string): provider is ApiProvider {
  return provider in PROVIDER_COLUMNS;
}

/**
 * Fetch available models dynamically from providers
 */
async function fetchAvailableModels(): Promise<Record<string, Array<{ value: string; label: string }>>> {
  // Check cache first
  if (modelCache && modelCache.expiresAt > Date.now()) {
    return modelCache.data;
  }

  const models: Record<string, Array<{ value: string; label: string }>> = {};

  try {
    // Fetch Claude models from Anthropic API
    const claudeApiKey = await getApiKeyForProvider("claude");
    if (claudeApiKey) {
      try {
        const response = await fetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": claudeApiKey,
            "anthropic-version": "2023-06-01",
          },
        });
        if (response.ok) {
          const data = await response.json() as ClaudeModelsResponse;
          models.claude = data.models?.map((model) => ({
            value: model.id,
            label: model.display_name || model.id,
          })) || FALLBACK_MODELS.claude;
        } else {
          models.claude = FALLBACK_MODELS.claude;
        }
      } catch {
        models.claude = FALLBACK_MODELS.claude;
      }
    } else {
      models.claude = FALLBACK_MODELS.claude;
    }

    // Fetch OpenAI models
    const settings = await prisma.userSettings.findFirst();
    const openaiApiKey = settings?.chatgptApiKeyEncrypted ? decrypt(settings.chatgptApiKeyEncrypted) : null;
    if (openaiApiKey) {
      try {
        const response = await fetch("https://api.openai.com/v1/models", {
          headers: {
            "Authorization": `Bearer ${openaiApiKey}`,
          },
        });
        if (response.ok) {
          const data = await response.json() as OpenAIModelsResponse;
          const gptModels = data.data?.filter((model) =>
            model.id.includes("gpt") || model.id.includes("o1")
          ).map((model) => ({
            value: model.id,
            label: model.id.replace(/-/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()),
          })) || [];
          models.chatgpt = gptModels.length > 0 ? gptModels : FALLBACK_MODELS.chatgpt;
        } else {
          models.chatgpt = FALLBACK_MODELS.chatgpt;
        }
      } catch {
        models.chatgpt = FALLBACK_MODELS.chatgpt;
      }
    } else {
      models.chatgpt = FALLBACK_MODELS.chatgpt;
    }

    // Fetch Gemini models
    const geminiApiKey = settings?.geminiApiKeyEncrypted ? decrypt(settings.geminiApiKeyEncrypted) : null;
    if (geminiApiKey) {
      try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${geminiApiKey}`);
        if (response.ok) {
          const data = await response.json() as GeminiModelsResponse;
          const geminiModels = data.models?.filter((model) =>
            model.supportedGenerationMethods?.includes("generateContent")
          ).map((model) => ({
            value: model.name.replace("models/", ""),
            label: model.displayName || model.name.replace("models/", ""),
          })) || [];
          models.gemini = geminiModels.length > 0 ? geminiModels : FALLBACK_MODELS.gemini;
        } else {
          models.gemini = FALLBACK_MODELS.gemini;
        }
      } catch {
        models.gemini = FALLBACK_MODELS.gemini;
      }
    } else {
      models.gemini = FALLBACK_MODELS.gemini;
    }
  } catch (error) {
    console.error("Error fetching dynamic models:", error);
    // Return fallback models if anything fails
    return FALLBACK_MODELS;
  }

  // Cache the results
  modelCache = {
    data: models,
    expiresAt: Date.now() + MODEL_CACHE_DURATION,
  };

  return models;
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
      defaultCategoryId: settings.defaultCategoryId,
      activeMode: settings.activeMode,
    };
  })

  // Update settings
  .patch(
    "/",
    async ({  body, set  }: any) => {
      const { model, provider = "claude" } = body as any;

      if (!isValidProvider(provider)) {
        set.status = 400;
        return { error: `無効なプロバイダです: ${provider}` };
      }

      // モデルIDのバリデーション
      const availableModels = await fetchAvailableModels();
      const providerModels = availableModels[provider];
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
