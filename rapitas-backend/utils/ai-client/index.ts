/**
 * Multi-provider AI Client Utility
 *
 * Provides a unified interface for Claude / ChatGPT / Gemini.
 *
 * Submodules:
 * - types.ts: Type definitions and constants
 * - credentials.ts: API key management and authentication
 * - error-handler.ts: Error handling
 * - claude-provider.ts: Claude API calls
 * - chatgpt-provider.ts: OpenAI API calls
 * - gemini-provider.ts: Gemini API calls
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
 * Execute with a paid API provider (fallback target when Ollama fails).
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
 * Execute streaming with a paid API provider (fallback target when Ollama fails).
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
 * Unified AI chat API (non-streaming).
 */
export async function sendAIMessage(options: AIRequestOptions): Promise<AIResponse> {
  const provider = options.provider || 'claude';

  // Local LLM (Ollama preferred -> llama-server -> paid API fallback)
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
      log.warn({ err: error }, 'Local LLM failed, falling back to paid API');
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
 * Unified AI chat API (streaming).
 */
export async function sendAIMessageStream(options: AIRequestOptions): Promise<ReadableStream> {
  const provider = options.provider || 'claude';

  // Local LLM (Ollama preferred -> llama-server -> paid API fallback)
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
      log.warn({ err: error }, 'Local LLM stream failed, falling back to paid API');
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
