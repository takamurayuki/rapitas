/**
 * AIクライアント型定義・定数
 */

export type AIProvider = 'claude' | 'chatgpt' | 'gemini';

export type AIMessage = {
  role: 'user' | 'assistant' | 'system';
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

export type ProviderKeyColumn =
  | 'claudeApiKeyEncrypted'
  | 'chatgptApiKeyEncrypted'
  | 'geminiApiKeyEncrypted';
export type ProviderModelColumn =
  | 'claudeDefaultModel'
  | 'chatgptDefaultModel'
  | 'geminiDefaultModel';

export const PROVIDER_KEY_COLUMNS: Record<AIProvider, ProviderKeyColumn> = {
  claude: 'claudeApiKeyEncrypted',
  chatgpt: 'chatgptApiKeyEncrypted',
  gemini: 'geminiApiKeyEncrypted',
};

export const PROVIDER_MODEL_COLUMNS: Record<AIProvider, ProviderModelColumn> = {
  claude: 'claudeDefaultModel',
  chatgpt: 'chatgptDefaultModel',
  gemini: 'geminiDefaultModel',
};

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  claude: 'claude-sonnet-4-20250514',
  chatgpt: 'gpt-4o',
  gemini: 'gemini-2.5-flash',
};

export const PROVIDER_NAMES: Record<AIProvider, string> = {
  claude: 'Claude',
  chatgpt: 'OpenAI',
  gemini: 'Gemini',
};
