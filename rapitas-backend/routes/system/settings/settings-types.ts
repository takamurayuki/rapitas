/**
 * SettingsTypes
 *
 * Type definitions, constants, and pure utility functions shared across
 * all settings route handlers.
 *
 * Not responsible for database access or HTTP routing.
 */

// ============================================================================
// Request body interfaces
// ============================================================================

/** Body for PATCH /settings */
export interface UserSettingsUpdateBody {
  developerModeDefault?: boolean;
  aiTaskAnalysisDefault?: boolean;
  autoResumeInterruptedTasks?: boolean;
  autoExecuteAfterCreate?: boolean;
  autoGenerateTitle?: boolean;
  autoGenerateTitleDelay?: number;
  autoCreateAfterTitleGeneration?: boolean;
  autoApprovePlan?: boolean;
  autoComplexityAnalysis?: boolean;
  defaultAiProvider?: string;
  defaultCategoryId?: number | null;
  activeMode?: string;
}

/** Body for POST /settings/api-key */
export interface ApiKeyBody {
  apiKey: string;
  provider?: string;
}

/** Body for POST /settings/model */
export interface ModelConfigBody {
  model?: string;
  provider?: string;
}

// ============================================================================
// Provider maps
// ============================================================================

/** Maps provider IDs to their encrypted API-key column names. */
export const PROVIDER_COLUMNS = {
  claude: 'claudeApiKeyEncrypted',
  chatgpt: 'chatgptApiKeyEncrypted',
  gemini: 'geminiApiKeyEncrypted',
} as const;

/** Maps provider IDs to their default-model column names. */
export const PROVIDER_MODEL_COLUMNS = {
  claude: 'claudeDefaultModel',
  chatgpt: 'chatgptDefaultModel',
  gemini: 'geminiDefaultModel',
} as const;

export type ApiProvider = keyof typeof PROVIDER_COLUMNS;

/**
 * Returns true if the given string is a recognised provider ID.
 *
 * @param provider - String to test / テストする文字列
 * @returns Whether the string is a valid ApiProvider / 有効なApiProviderかどうか
 */
export function isValidProvider(provider: string): provider is ApiProvider {
  return provider in PROVIDER_COLUMNS;
}

// ============================================================================
// API response types
// ============================================================================

/** Shape of Anthropic models list response. */
export interface ClaudeModelsResponse {
  models: Array<{
    id: string;
    display_name?: string;
  }>;
}

/** Shape of OpenAI models list response. */
export interface OpenAIModelsResponse {
  data: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
  }>;
}

/** Shape of Gemini models list response. */
export interface GeminiModelsResponse {
  models: Array<{
    name: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
  }>;
}

// ============================================================================
// Fallback model lists
// ============================================================================

/** Fallback models used when dynamic fetching from provider APIs fails. */
export const FALLBACK_MODELS: Record<string, Array<{ value: string; label: string }>> = {
  claude: [
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
    { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
  ],
  chatgpt: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
    { value: 'o1', label: 'o1' },
    { value: 'o1-mini', label: 'o1 Mini' },
    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  ],
  gemini: [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
    { value: 'gemini-2.0-flash-exp', label: 'Gemini 2.0 Flash (Experimental)' },
    { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { value: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B' },
  ],
};

// ============================================================================
// Validation
// ============================================================================

/**
 * Validates the API key format for the given provider.
 * Prevents saving obviously malformed keys without a live API round-trip.
 *
 * @param apiKey - The raw API key string / 生のAPIキー文字列
 * @param provider - Target provider / 対象プロバイダ
 * @returns Validation result with an optional error message / バリデーション結果（エラーメッセージ付き）
 */
export function validateApiKeyFormat(
  apiKey: string,
  provider: ApiProvider,
): { valid: boolean; error?: string } {
  const trimmed = apiKey.trim();

  if (!trimmed) {
    return { valid: false, error: 'APIキーを入力してください' };
  }

  if (trimmed.length < 10) {
    return { valid: false, error: 'APIキーが短すぎます（10文字以上必要です）' };
  }

  switch (provider) {
    case 'claude':
      if (!trimmed.startsWith('sk-ant-api')) {
        return {
          valid: false,
          error: 'Claude APIキーは「sk-ant-api」で始まる必要があります',
        };
      }
      break;
    case 'chatgpt':
      if (!trimmed.startsWith('sk-')) {
        return {
          valid: false,
          error: 'OpenAI APIキーは「sk-」で始まる必要があります',
        };
      }
      // Prevent accidental use of Claude API key
      if (trimmed.startsWith('sk-ant-api')) {
        return {
          valid: false,
          error: 'これはClaude APIキーです。OpenAI APIキーを入力してください',
        };
      }
      break;
    case 'gemini':
      if (!trimmed.startsWith('AIza')) {
        return {
          valid: false,
          error: 'Gemini APIキーは「AIza」で始まる必要があります',
        };
      }
      break;
  }

  return { valid: true };
}
