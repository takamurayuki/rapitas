/**
 * マルチプロバイダーAIクライアントユーティリティ
 * Claude / ChatGPT / Gemini を統一的に扱う
 */
import { prisma } from "../config/database";
import { decrypt } from "./encryption";

export type AIProvider = "claude" | "chatgpt" | "gemini";

export type AIMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type AIRequestOptions = {
  provider?: AIProvider;
  model?: string;
  messages: AIMessage[];
  systemPrompt?: string;
  maxTokens?: number;
};

export type AIResponse = {
  content: string;
  tokensUsed: number;
};

type ProviderKeyColumn = "claudeApiKeyEncrypted" | "chatgptApiKeyEncrypted" | "geminiApiKeyEncrypted";
type ProviderModelColumn = "claudeDefaultModel" | "chatgptDefaultModel" | "geminiDefaultModel";

const PROVIDER_KEY_COLUMNS: Record<AIProvider, ProviderKeyColumn> = {
  claude: "claudeApiKeyEncrypted",
  chatgpt: "chatgptApiKeyEncrypted",
  gemini: "geminiApiKeyEncrypted",
};

const PROVIDER_MODEL_COLUMNS: Record<AIProvider, ProviderModelColumn> = {
  claude: "claudeDefaultModel",
  chatgpt: "chatgptDefaultModel",
  gemini: "geminiDefaultModel",
};

const DEFAULT_MODELS: Record<AIProvider, string> = {
  claude: "claude-sonnet-4-20250514",
  chatgpt: "gpt-4o",
  gemini: "gemini-2.5-flash",
};

/**
 * APIキーの基本的な形式を検証
 */
function isValidApiKeyFormat(apiKey: string, provider: AIProvider): boolean {
  const trimmed = apiKey.trim();
  if (!trimmed || trimmed.length < 10) return false;

  switch (provider) {
    case "claude":
      return trimmed.startsWith("sk-ant-api");
    case "chatgpt":
      return trimmed.startsWith("sk-") && !trimmed.startsWith("sk-ant-api");
    case "gemini":
      return trimmed.startsWith("AIza");
    default:
      return true;
  }
}

/**
 * 指定プロバイダーのAPIキーをDBから取得・復号化
 * DBに保存されたキーを優先し、存在しない場合のみ環境変数にフォールバック
 */
export async function getApiKeyForProvider(provider: AIProvider): Promise<string | null> {
  // まずDBから取得を試みる（ユーザーが設定画面で登録したキーを優先）
  const settings = await prisma.userSettings.findFirst();
  if (settings) {
    const column = PROVIDER_KEY_COLUMNS[provider];
    const encrypted = settings[column];
    if (encrypted) {
      try {
        const decrypted = decrypt(encrypted);
        if (decrypted && isValidApiKeyFormat(decrypted, provider)) {
          return decrypted;
        }
        // 復号できたが形式が不正な場合はログ出力して環境変数にフォールバック
        console.warn(`[ai-client] DB stored ${provider} API key has invalid format, falling back to env var`);
      } catch (error) {
        console.warn(`[ai-client] Failed to decrypt ${provider} API key from DB:`, error instanceof Error ? error.message : error);
      }
    }
  }

  // DBにキーがない場合、Claude のみ環境変数にフォールバック
  if (provider === "claude" && process.env.CLAUDE_API_KEY) {
    const envKey = process.env.CLAUDE_API_KEY;
    if (isValidApiKeyFormat(envKey, provider)) {
      return envKey;
    }
    console.warn("[ai-client] CLAUDE_API_KEY env var has invalid format");
  }

  return null;
}

/**
 * 指定プロバイダーのデフォルトモデルをDBから取得
 */
export async function getDefaultModel(provider: AIProvider): Promise<string> {
  const settings = await prisma.userSettings.findFirst();
  if (settings) {
    const column = PROVIDER_MODEL_COLUMNS[provider];
    const model = settings[column];
    if (model) return model;
  }
  return DEFAULT_MODELS[provider];
}

/**
 * ユーザーのデフォルトAIプロバイダーを取得
 */
export async function getDefaultProvider(): Promise<AIProvider> {
  const settings = await prisma.userSettings.findFirst();
  if (settings?.defaultAiProvider) {
    return settings.defaultAiProvider as AIProvider;
  }
  return "claude";
}

/**
 * デフォルトプロバイダーのAPIキーが設定されているか確認
 */
export async function isAnyApiKeyConfigured(): Promise<boolean> {
  const provider = await getDefaultProvider();
  const key = await getApiKeyForProvider(provider);
  return !!key;
}

/**
 * どのプロバイダーが設定済みか返す
 */
export async function getConfiguredProviders(): Promise<AIProvider[]> {
  const providers: AIProvider[] = ["claude", "chatgpt", "gemini"];
  const configured: AIProvider[] = [];
  for (const p of providers) {
    const key = await getApiKeyForProvider(p);
    if (key) configured.push(p);
  }
  return configured;
}

/**
 * Claude APIを呼び出す
 */
async function callClaude(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<AIResponse> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  // system role のメッセージを分離
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const systemContent =
    systemPrompt ||
    messages.find((m) => m.role === "system")?.content ||
    undefined;

  // リトライ（529 Overloaded / 429 Rate Limit 対応）
  const MAX_RETRIES = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        ...(systemContent ? { system: systemContent } : {}),
        messages: chatMessages,
      });

      const textBlock = response.content.find(
        (c: { type: string }) => c.type === "text",
      );
      const content = textBlock && textBlock.type === "text" ? textBlock.text : "";
      const tokensUsed =
        (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

      return { content, tokensUsed };
    } catch (error: unknown) {
      lastError = error;
      const status = (error as { status?: number }).status;
      const isRetryable = status === 429 || status === 529 || (status !== undefined && status >= 500);
      if (!isRetryable || attempt === MAX_RETRIES) {
        throw error;
      }
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      console.warn(`Claude API error (status ${status}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * OpenAI (ChatGPT) APIを呼び出す
 */
async function callChatGPT(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<AIResponse> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey });

  const chatMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  if (systemPrompt) {
    chatMessages.push({ role: "system", content: systemPrompt });
  }

  for (const m of messages) {
    chatMessages.push({ role: m.role, content: m.content });
  }

  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: chatMessages,
  });

  const content = response.choices[0]?.message?.content || "";
  const tokensUsed =
    (response.usage?.prompt_tokens || 0) +
    (response.usage?.completion_tokens || 0);

  return { content, tokensUsed };
}

/**
 * Google Gemini APIを呼び出す
 */
async function callGemini(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<AIResponse> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);

  const generativeModel = genAI.getGenerativeModel({
    model,
    ...(systemPrompt
      ? { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
      : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
    },
  });

  // Gemini のチャット形式に変換
  const history = messages
    .filter((m) => m.role !== "system")
    .slice(0, -1)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const lastMessage = messages.filter((m) => m.role !== "system").slice(-1)[0];
  if (!lastMessage) {
    return { content: "", tokensUsed: 0 };
  }

  const chat = generativeModel.startChat({ history });
  const result = await chat.sendMessage(lastMessage.content);
  const response = result.response;
  const content = response.text();

  // Gemini はトークン使用量の取得方法が異なる
  const tokensUsed =
    (response.usageMetadata?.promptTokenCount || 0) +
    (response.usageMetadata?.candidatesTokenCount || 0);

  return { content, tokensUsed };
}

const PROVIDER_NAMES: Record<AIProvider, string> = {
  claude: "Claude",
  chatgpt: "OpenAI",
  gemini: "Gemini",
};

/**
 * エラーメッセージからエラー種別を判定し、ユーザー向けメッセージに変換
 */
function formatApiError(error: unknown, provider: AIProvider): string {
  const message = error instanceof Error ? error.message : String(error);

  const isAuthError =
    message.includes("authentication_error") ||
    message.includes("invalid x-api-key") ||
    message.includes("invalid api key") ||
    message.includes("Incorrect API key") ||
    message.includes("401") ||
    message.includes("API key not valid");

  if (isAuthError) {
    return `${PROVIDER_NAMES[provider]} APIキーが無効です。設定画面で正しいAPIキーを再設定してください。`;
  }

  const isOverloaded =
    message.includes("529") ||
    message.includes("overloaded") ||
    message.includes("Overloaded");

  if (isOverloaded) {
    return `${PROVIDER_NAMES[provider]} APIが現在混雑しています。しばらく待ってから再度お試しください。`;
  }

  const isQuotaError =
    message.includes("429") ||
    message.includes("Too Many Requests") ||
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("RESOURCE_EXHAUSTED");

  if (isQuotaError) {
    const isFreeeTier = message.includes("free_tier") || message.includes("FreeTier");
    if (isFreeeTier) {
      return `${PROVIDER_NAMES[provider]} APIの無料枠のクォータを超過しました。Google Cloud Consoleで課金（Billing）を有効にするか、有料プランにアップグレードしてください。詳細: https://ai.google.dev/gemini-api/docs/rate-limits`;
    }
    return `${PROVIDER_NAMES[provider]} APIのレート制限に達しました。しばらく待ってから再度お試しください。`;
  }

  const isModelNotFound =
    message.includes("404") ||
    message.includes("not found") ||
    message.includes("is not found");

  if (isModelNotFound) {
    return `${PROVIDER_NAMES[provider]} の指定されたモデルが見つかりません。設定画面でモデルを変更してください。`;
  }

  return error instanceof Error ? error.message : "AIとの通信中にエラーが発生しました";
}

/**
 * Claude APIストリーミング呼び出し
 */
export async function callClaudeStream(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<ReadableStream> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const systemContent =
    systemPrompt ||
    messages.find((m) => m.role === "system")?.content ||
    undefined;

  return new ReadableStream({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model,
          max_tokens: maxTokens,
          ...(systemContent ? { system: systemContent } : {}),
          messages: chatMessages,
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            const data = JSON.stringify({ content: event.delta.text });
            controller.enqueue(
              new TextEncoder().encode(`data: ${data}\n\n`),
            );
          }
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error: unknown) {
        const errorData = JSON.stringify({
          error: formatApiError(error, "claude"),
        });
        controller.enqueue(
          new TextEncoder().encode(`data: ${errorData}\n\n`),
        );
        controller.close();
      }
    },
  });
}

/**
 * OpenAI ストリーミング呼び出し
 */
export async function callChatGPTStream(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<ReadableStream> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey });

  const chatMessages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [];

  if (systemPrompt) {
    chatMessages.push({ role: "system", content: systemPrompt });
  }
  for (const m of messages) {
    chatMessages.push({ role: m.role, content: m.content });
  }

  return new ReadableStream({
    async start(controller) {
      try {
        const stream = await client.chat.completions.create({
          model,
          max_tokens: maxTokens,
          messages: chatMessages,
          stream: true,
        });

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            const data = JSON.stringify({ content });
            controller.enqueue(
              new TextEncoder().encode(`data: ${data}\n\n`),
            );
          }
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error: unknown) {
        const errorData = JSON.stringify({
          error: formatApiError(error, "chatgpt"),
        });
        controller.enqueue(
          new TextEncoder().encode(`data: ${errorData}\n\n`),
        );
        controller.close();
      }
    },
  });
}

/**
 * Gemini ストリーミング呼び出し
 */
export async function callGeminiStream(
  apiKey: string,
  model: string,
  messages: AIMessage[],
  systemPrompt: string | undefined,
  maxTokens: number,
): Promise<ReadableStream> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(apiKey);

  const generativeModel = genAI.getGenerativeModel({
    model,
    ...(systemPrompt
      ? { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
      : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
    },
  });

  const history = messages
    .filter((m) => m.role !== "system")
    .slice(0, -1)
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const lastMessage = messages.filter((m) => m.role !== "system").slice(-1)[0];

  return new ReadableStream({
    async start(controller) {
      try {
        if (!lastMessage) {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }

        const chat = generativeModel.startChat({ history });
        const result = await chat.sendMessageStream(lastMessage.content);

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            const data = JSON.stringify({ content: text });
            controller.enqueue(
              new TextEncoder().encode(`data: ${data}\n\n`),
            );
          }
        }
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error: unknown) {
        const errorData = JSON.stringify({
          error: formatApiError(error, "gemini"),
        });
        controller.enqueue(
          new TextEncoder().encode(`data: ${errorData}\n\n`),
        );
        controller.close();
      }
    },
  });
}

/**
 * APIエラーを判定し、わかりやすいエラーメッセージに変換
 */
function handleApiError(error: unknown, provider: AIProvider): never {
  const userMessage = formatApiError(error, provider);
  const originalMessage = error instanceof Error ? error.message : String(error);

  // ユーザー向けメッセージに変換された場合は新しいErrorを投げる
  if (userMessage !== originalMessage) {
    throw new Error(userMessage);
  }

  throw error;
}

/**
 * 統一AIチャットAPI（非ストリーミング）
 */
export async function sendAIMessage(
  options: AIRequestOptions,
): Promise<AIResponse> {
  const provider = options.provider || "claude";
  const apiKey = await getApiKeyForProvider(provider);

  if (!apiKey) {
    throw new Error(
      `${PROVIDER_NAMES[provider]} APIキーが設定されていません。設定画面でAPIキーを設定してください。`,
    );
  }

  const model = options.model || (await getDefaultModel(provider));
  const maxTokens = options.maxTokens || 2048;

  try {
    switch (provider) {
      case "claude":
        return await callClaude(apiKey, model, options.messages, options.systemPrompt, maxTokens);
      case "chatgpt":
        return await callChatGPT(apiKey, model, options.messages, options.systemPrompt, maxTokens);
      case "gemini":
        return await callGemini(apiKey, model, options.messages, options.systemPrompt, maxTokens);
      default:
        throw new Error(`未対応のプロバイダーです: ${provider}`);
    }
  } catch (error) {
    handleApiError(error, provider);
  }
}

/**
 * 統一AIチャットAPI（ストリーミング）
 */
export async function sendAIMessageStream(
  options: AIRequestOptions,
): Promise<ReadableStream> {
  const provider = options.provider || "claude";
  const apiKey = await getApiKeyForProvider(provider);

  if (!apiKey) {
    throw new Error(
      `${PROVIDER_NAMES[provider]} APIキーが設定されていません。設定画面でAPIキーを設定してください。`,
    );
  }

  const model = options.model || (await getDefaultModel(provider));
  const maxTokens = options.maxTokens || 2048;

  switch (provider) {
    case "claude":
      return callClaudeStream(apiKey, model, options.messages, options.systemPrompt, maxTokens);
    case "chatgpt":
      return callChatGPTStream(apiKey, model, options.messages, options.systemPrompt, maxTokens);
    case "gemini":
      return callGeminiStream(apiKey, model, options.messages, options.systemPrompt, maxTokens);
    default:
      throw new Error(`未対応のプロバイダーです: ${provider}`);
  }
}
