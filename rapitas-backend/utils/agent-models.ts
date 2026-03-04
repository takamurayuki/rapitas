/**
 * Agent Models Configuration
 * Dynamic model retrieval for different agent types
 */

type ModelInfo = {
  value: string;
  label: string;
  description?: string;
};

// API Response Types
interface AnthropicModelsResponse {
  models?: Array<{
    id: string;
    display_name?: string;
    description?: string;
  }>;
}

interface OpenAIModelsResponse {
  data?: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }>;
}

interface GoogleModelsResponse {
  models?: Array<{
    name: string;
    displayName?: string;
    description?: string;
  }>;
}

/**
 * Get available models for Claude Code agent
 */
async function getClaudeCodeModels(): Promise<ModelInfo[]> {
  try {
    // Try to get models from claude CLI
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const { stdout } = await execAsync("claude model list --json", { timeout: 5000 });
    const models = JSON.parse(stdout);

    return models.map((m: { id?: string; name?: string; description?: string }) => ({
      value: m.id || m.name,
      label: m.name || m.id,
      description: m.description,
    }));
  } catch (error) {
    // Fallback to known models (using latest official model IDs)
    return [
      { value: "claude-opus-4-6", label: "Claude Opus 4.6", description: "最も高性能なモデル（最新）" },
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "高速で実用的なモデル（最新）" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "軽量で高速なモデル（最新）" },
      { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", description: "高速で実用的なモデル" },
      { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", description: "バランスの取れたモデル" },
    ];
  }
}

/**
 * Get available models for Anthropic API
 */
async function getAnthropicAPIModels(): Promise<ModelInfo[]> {
  try {
    // Try to fetch from Anthropic API
    const response = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "anthropic-version": "2023-06-01",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json() as AnthropicModelsResponse;
      return data.models?.map((m) => ({
        value: m.id,
        label: m.display_name || m.id,
        description: m.description,
      })) || [];
    }
  } catch (error) {
    // Ignore error and use fallback
  }

  // Fallback to known models (using latest official model IDs)
  return [
    { value: "claude-opus-4-6", label: "Claude Opus 4.6", description: "最も高性能なモデル（最新）" },
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", description: "高速で実用的なモデル（最新）" },
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", description: "軽量で高速なモデル（最新）" },
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", description: "高速で実用的なモデル" },
    { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", description: "バランスの取れたモデル" },
  ];
}

/**
 * Get available models for OpenAI
 */
async function getOpenAIModels(): Promise<ModelInfo[]> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY || ""}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json() as OpenAIModelsResponse;
      const gptModels = data.data?.filter((m) =>
        m.id.includes("gpt") && !m.id.includes("instruct") && !m.id.includes("0125")
      );

      return gptModels?.map((m) => ({
        value: m.id,
        label: m.id.replace(/-/g, " ").replace(/gpt/g, "GPT").replace(/\b\w/g, (l: string) => l.toUpperCase()),
        description: m.id.includes("4o") ? "マルチモーダル対応" :
                     m.id.includes("turbo") ? "高速版" :
                     m.id.includes("3.5") ? "コスト効率重視" : undefined,
      })) || [];
    }
  } catch (error) {
    // Ignore error and use fallback
  }

  // Fallback to known models
  return [
    { value: "gpt-4o", label: "GPT-4o", description: "マルチモーダル対応の最新モデル" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini", description: "高速・軽量版" },
    { value: "gpt-4-turbo", label: "GPT-4 Turbo", description: "高速で長文対応" },
    { value: "gpt-4", label: "GPT-4", description: "高性能なモデル" },
    { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", description: "コスト効率の良いモデル" },
  ];
}

/**
 * Get available models for Codex CLI
 */
async function getCodexModels(): Promise<ModelInfo[]> {
  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const { stdout } = await execAsync("codex models --json", { timeout: 5000 });
    const models = JSON.parse(stdout);

    return models.map((m: { id?: string; name?: string; description?: string }) => ({
      value: m.id || m.name,
      label: m.name || m.id,
      description: m.description,
    }));
  } catch (error) {
    // Fallback to known models
    return [
      { value: "gpt-4-turbo", label: "GPT-4 Turbo", description: "高性能・ChatGPTアカウント対応" },
      { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo", description: "高速・低コスト" },
      { value: "gpt-4o", label: "GPT-4o", description: "最新マルチモーダル（APIキー必須）" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini", description: "高速軽量版（APIキー必須）" },
      { value: "o1-preview", label: "o1 Preview", description: "推論特化モデル" },
      { value: "o1-mini", label: "o1 Mini", description: "軽量推論モデル" },
    ];
  }
}

/**
 * Get available models for Gemini
 */
async function getGeminiModels(): Promise<ModelInfo[]> {
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1/models", {
      headers: {
        "x-api-key": process.env.GOOGLE_API_KEY || "",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.ok) {
      const data = await response.json() as GoogleModelsResponse;
      const geminiModels = data.models?.filter((m) => m.name.includes("gemini"));

      return geminiModels?.map((m) => ({
        value: m.name.split("/").pop() || m.name,
        label: m.displayName || m.name,
        description: m.description,
      })) || [];
    }
  } catch (error) {
    // Ignore error and use fallback
  }

  // Fallback to known models
  return [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "最新高速モデル" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", description: "最新軽量モデル" },
    { value: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash", description: "実験的高速モデル" },
    { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro", description: "高性能モデル" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash", description: "高速モデル" },
    { value: "gemini-1.5-flash-8b", label: "Gemini 1.5 Flash 8B", description: "軽量・高速モデル" },
  ];
}

/**
 * Get available models for a specific agent type
 */
export async function getModelsForAgentType(agentType: string): Promise<ModelInfo[]> {
  switch (agentType) {
    case "claude-code":
      return getClaudeCodeModels();
    case "anthropic-api":
      return getAnthropicAPIModels();
    case "codex":
      return getCodexModels();
    case "openai":
      return getOpenAIModels();
    case "gemini":
      return getGeminiModels();
    case "azure-openai":
      // Azure OpenAI uses deployment names, not model IDs
      return [
        { value: "gpt-4o", label: "GPT-4o", description: "デプロイ名を指定" },
        { value: "gpt-4", label: "GPT-4", description: "デプロイ名を指定" },
        { value: "gpt-35-turbo", label: "GPT-3.5 Turbo", description: "デプロイ名を指定" },
      ];
    case "custom":
      return []; // Custom agents define their own models
    default:
      return [];
  }
}

/**
 * Get all available models grouped by agent type
 */
export async function getAllModels(): Promise<Record<string, ModelInfo[]>> {
  const agentTypes = ["claude-code", "anthropic-api", "codex", "openai", "gemini", "azure-openai"];
  const result: Record<string, ModelInfo[]> = {};

  await Promise.all(
    agentTypes.map(async (type) => {
      result[type] = await getModelsForAgentType(type);
    })
  );

  return result;
}