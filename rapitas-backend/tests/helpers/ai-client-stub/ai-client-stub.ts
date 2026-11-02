/**
 * ai-client-stub
 *
 * A complete stand-in for `utils/ai-client` to pass to `mock.module`. bun
 * replaces the WHOLE module for the process, so a factory that returns only
 * the one function a test cares about breaks every other importer of that
 * module with "Export named … not found" and its tests silently vanish (#1286).
 * The paired test fails when ai-client gains an export this stub lacks.
 */
import { PROVIDER_NAMES } from '../../../utils/ai-client/types';
import type { AIRequestOptions, AIResponse } from '../../../utils/ai-client/types';

const reply = async (): Promise<AIResponse> => ({ content: '{}', tokensUsed: 0 });
const stream = async (): Promise<ReadableStream> => new ReadableStream();

/** Every export of utils/ai-client, inert. */
function defaults() {
  return {
    PROVIDER_NAMES,
    sendAIMessage: reply as (options: AIRequestOptions) => Promise<AIResponse>,
    sendAIMessageStream: stream as (options: AIRequestOptions) => Promise<ReadableStream>,
    callClaude: reply,
    callClaudeStream: stream,
    callClaudeCli: reply,
    callClaudeCliStream: stream,
    callChatGPT: reply,
    callChatGPTStream: stream,
    callGemini: reply,
    callGeminiStream: stream,
    callOllama: reply,
    callOllamaStream: stream,
    checkOllamaConnection: async () => false,
    isClaudeCliAvailable: async () => false,
    formatApiError: (e: unknown) => String(e),
    handleApiError: (e: unknown): AIResponse => ({ content: String(e), tokensUsed: 0 }),
    isValidApiKeyFormat: () => true,
    getApiKeyForProvider: async (): Promise<string | null> => null,
    getDefaultModel: () => 'stub-model',
    getDefaultProvider: async () => 'claude' as const,
    isAnyApiKeyConfigured: async () => false,
    getConfiguredProviders: async (): Promise<string[]> => [],
    getOllamaUrl: () => 'http://127.0.0.1:11434',
    getAuxAiMode: () => 'off' as const,
  };
}

/**
 * Build a full ai-client module stub, replacing only what the test needs.
 *
 * @param overrides - Exports to replace / 差し替える export
 * @returns An object usable as a `mock.module` factory result / mock.module に渡すモジュール
 */
export function aiClientStub<T extends Partial<ReturnType<typeof defaults>>>(
  overrides: T = {} as T,
) {
  return { ...defaults(), ...overrides };
}
