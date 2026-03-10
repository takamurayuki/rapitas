/**
 * マルチプロバイダーAIクライアントユーティリティ
 * Claude / ChatGPT / Gemini を統一的に扱う
 *
 * 各サブモジュール:
 * - types.ts: 型定義・定数
 * - credentials.ts: APIキー管理・認証情報
 * - error-handler.ts: エラーハンドリング
 * - claude-provider.ts: Claude API呼び出し
 * - chatgpt-provider.ts: OpenAI API呼び出し
 * - gemini-provider.ts: Gemini API呼び出し
 */

// --- Re-exports ---
export type { AIProvider, AIMessage, AIRequestOptions, AIResponse } from './types';
export { PROVIDER_NAMES } from './types';

export {
  isValidApiKeyFormat,
  getApiKeyForProvider,
  getDefaultModel,
  getDefaultProvider,
  isAnyApiKeyConfigured,
  getConfiguredProviders,
} from './credentials';

export { formatApiError, handleApiError } from './error-handler';

export { callClaude, callClaudeStream } from './claude-provider';
export { callChatGPT, callChatGPTStream } from './chatgpt-provider';
export { callGemini, callGeminiStream } from './gemini-provider';

// --- Unified API ---
import { type AIRequestOptions, type AIResponse, PROVIDER_NAMES } from './types';
import { getApiKeyForProvider, getDefaultModel } from './credentials';
import { handleApiError } from './error-handler';
import { callClaude } from './claude-provider';
import { callChatGPT } from './chatgpt-provider';
import { callGemini } from './gemini-provider';
import { callClaudeStream } from './claude-provider';
import { callChatGPTStream } from './chatgpt-provider';
import { callGeminiStream } from './gemini-provider';

/**
 * 統一AIチャットAPI（非ストリーミング）
 */
export async function sendAIMessage(options: AIRequestOptions): Promise<AIResponse> {
  const provider = options.provider || 'claude';
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
      case 'claude':
        return await callClaude(apiKey, model, options.messages, options.systemPrompt, maxTokens);
      case 'chatgpt':
        return await callChatGPT(apiKey, model, options.messages, options.systemPrompt, maxTokens);
      case 'gemini':
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
export async function sendAIMessageStream(options: AIRequestOptions): Promise<ReadableStream> {
  const provider = options.provider || 'claude';
  const apiKey = await getApiKeyForProvider(provider);

  if (!apiKey) {
    throw new Error(
      `${PROVIDER_NAMES[provider]} APIキーが設定されていません。設定画面でAPIキーを設定してください。`,
    );
  }

  const model = options.model || (await getDefaultModel(provider));
  const maxTokens = options.maxTokens || 2048;

  switch (provider) {
    case 'claude':
      return callClaudeStream(apiKey, model, options.messages, options.systemPrompt, maxTokens);
    case 'chatgpt':
      return callChatGPTStream(apiKey, model, options.messages, options.systemPrompt, maxTokens);
    case 'gemini':
      return callGeminiStream(apiKey, model, options.messages, options.systemPrompt, maxTokens);
    default:
      throw new Error(`未対応のプロバイダーです: ${provider}`);
  }
}
