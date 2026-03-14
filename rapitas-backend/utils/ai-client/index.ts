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
  getOllamaUrl,
} from './credentials';

export { formatApiError, handleApiError } from './error-handler';

export { callClaude, callClaudeStream } from './claude-provider';
export { callChatGPT, callChatGPTStream } from './chatgpt-provider';
export { callGemini, callGeminiStream } from './gemini-provider';
export { callOllama, callOllamaStream, checkOllamaConnection } from './ollama-provider';

// --- Unified API ---
import { type AIProvider, type AIRequestOptions, type AIResponse, PROVIDER_NAMES } from './types';
import { getApiKeyForProvider, getDefaultModel, getDefaultProvider } from './credentials';
import { handleApiError } from './error-handler';
import { callClaude } from './claude-provider';
import { callChatGPT } from './chatgpt-provider';
import { callGemini } from './gemini-provider';
import { callOllama } from './ollama-provider';
import { callClaudeStream } from './claude-provider';
import { callChatGPTStream } from './chatgpt-provider';
import { callGeminiStream } from './gemini-provider';
import { callOllamaStream } from './ollama-provider';
import { getOllamaUrl } from './credentials';
import { ensureLocalLLM } from '../../services/local-llm';
import { createLogger } from '../../config';

const log = createLogger('ai-client');

/**
 * 有料APIで実行する（ollama フォールバック先）
 */
async function sendWithPaidProvider(options: AIRequestOptions): Promise<AIResponse> {
  const provider = await getDefaultProvider();
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
      return await callClaude(apiKey, model, options.messages, options.systemPrompt, maxTokens);
    case 'chatgpt':
      return await callChatGPT(apiKey, model, options.messages, options.systemPrompt, maxTokens);
    case 'gemini':
      return await callGemini(apiKey, model, options.messages, options.systemPrompt, maxTokens);
    default:
      throw new Error(`未対応のプロバイダーです: ${provider}`);
  }
}

/**
 * 有料APIでストリーミング実行する（ollama フォールバック先）
 */
async function sendStreamWithPaidProvider(options: AIRequestOptions): Promise<ReadableStream> {
  const provider = await getDefaultProvider();
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

/**
 * 統一AIチャットAPI（非ストリーミング）
 */
export async function sendAIMessage(options: AIRequestOptions): Promise<AIResponse> {
  const provider = options.provider || 'claude';

  // ローカルLLM（Ollama優先 → llama-server → 有料APIフォールバック）
  if (provider === 'ollama') {
    try {
      const ollamaUrl = await getOllamaUrl();
      const localLLM = await ensureLocalLLM(ollamaUrl, options.model);
      const maxTokens = options.maxTokens || 2048;
      return await callOllama(
        localLLM.url,
        localLLM.model,
        options.messages,
        options.systemPrompt,
        maxTokens,
      );
    } catch (error) {
      log.warn({ err: error }, 'ローカルLLM失敗、有料APIにフォールバック');
      return await sendWithPaidProvider(options);
    }
  }

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

  // ローカルLLM（Ollama優先 → llama-server → 有料APIフォールバック）
  if (provider === 'ollama') {
    try {
      const ollamaUrl = await getOllamaUrl();
      const localLLM = await ensureLocalLLM(ollamaUrl);
      const maxTokens = options.maxTokens || 2048;
      return await callOllamaStream(
        localLLM.url,
        localLLM.model,
        options.messages,
        options.systemPrompt,
        maxTokens,
      );
    } catch (error) {
      log.warn({ err: error }, 'ローカルLLM(stream)失敗、有料APIにフォールバック');
      return await sendStreamWithPaidProvider(options);
    }
  }

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
