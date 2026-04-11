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
import { buildRAGContext } from '../../services/memory/rag/context-builder';
import {
  generateCacheKey,
  getCachedResponse,
  setCachedResponse,
} from '../../services/local-llm/response-cache';

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

      // NOTE: RAG context injection — augments the small local model with relevant knowledge.
      let systemPrompt = options.systemPrompt;
      if (options.enableRAG) {
        try {
          const lastUserMsg = [...options.messages].reverse().find((m) => m.role === 'user');
          const query = lastUserMsg?.content.slice(0, 500) || '';
          if (query.length > 0) {
            const ragContext = await buildRAGContext(query, {
              limit: 3,
              minSimilarity: 0.5,
              themeId: options.ragThemeId,
            });
            if (ragContext.contextText.length > 0) {
              systemPrompt = ragContext.contextText + '\n\n---\n\n' + (systemPrompt || '');
              log.debug(
                { ragEntries: ragContext.entries.length },
                'RAG context injected for local LLM',
              );
            }
          }
        } catch (ragError) {
          // NOTE: RAG failure should not block the LLM call — degrade gracefully.
          log.warn({ err: ragError }, 'RAG injection failed, proceeding without context');
        }
      }

      // NOTE: Response cache — skip LLM call entirely on cache hit.
      if (!options.skipCache) {
        const cacheKey = generateCacheKey('ollama', localLLM.model, systemPrompt, options.messages);
        const cached = getCachedResponse(cacheKey);
        if (cached) {
          return cached;
        }

        const response = await callOllama(
          localLLM.url,
          localLLM.model,
          options.messages,
          systemPrompt,
          maxTokens,
        );
        setCachedResponse(
          cacheKey,
          response.content,
          response.tokensUsed,
          'ollama',
          localLLM.model,
        );
        return response;
      }

      return await callOllama(
        localLLM.url,
        localLLM.model,
        options.messages,
        systemPrompt,
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
