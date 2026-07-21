import { describe, test, expect, mock, afterEach } from 'bun:test';

const mockGetDefaultProvider = mock(() => Promise.resolve('claude'));
const mockGetApiKeyForProvider = mock(() => Promise.resolve('sk-key'));
const mockGetDefaultModel = mock(() => Promise.resolve('claude-model'));
const mockGetOllamaUrl = mock(() => Promise.resolve('http://localhost:11434'));
mock.module('./credentials', () => ({
  getApiKeyForProvider: mockGetApiKeyForProvider,
  getDefaultModel: mockGetDefaultModel,
  getDefaultProvider: mockGetDefaultProvider,
  isAnyApiKeyConfigured: () => Promise.resolve(true),
  getConfiguredProviders: () => Promise.resolve(['claude']),
  getOllamaUrl: mockGetOllamaUrl,
  isValidApiKeyFormat: () => true,
}));

const mockHandleApiError = mock((_err: unknown, _provider: string) => {
  throw new Error('handled');
});
mock.module('./error-handler', () => ({
  formatApiError: (e: unknown) => String(e),
  handleApiError: mockHandleApiError,
}));

const mockCallClaude = mock(() => Promise.resolve({ content: 'claude reply', tokensUsed: 10 }));
mock.module('./claude-provider', () => ({
  callClaude: mockCallClaude,
  callClaudeStream: mock(() => Promise.resolve(new ReadableStream())),
}));

const mockCallClaudeCli = mock(() => Promise.resolve({ content: 'cli reply', tokensUsed: 5 }));
mock.module('./claude-cli-provider', () => ({
  callClaudeCli: mockCallClaudeCli,
  callClaudeCliStream: mock(() => Promise.resolve(new ReadableStream())),
  isClaudeCliAvailable: () => Promise.resolve(true),
}));

const mockCallChatGPT = mock(() => Promise.resolve({ content: 'gpt reply', tokensUsed: 8 }));
mock.module('./chatgpt-provider', () => ({
  callChatGPT: mockCallChatGPT,
  callChatGPTStream: mock(() => Promise.resolve(new ReadableStream())),
}));

const mockCallGemini = mock(() => Promise.resolve({ content: 'gemini reply', tokensUsed: 7 }));
mock.module('./gemini-provider', () => ({
  callGemini: mockCallGemini,
  callGeminiStream: mock(() => Promise.resolve(new ReadableStream())),
}));

const mockCallOllama = mock(() => Promise.resolve({ content: 'ollama reply', tokensUsed: 3 }));
mock.module('./ollama-provider', () => ({
  callOllama: mockCallOllama,
  callOllamaStream: mock(() => Promise.resolve(new ReadableStream())),
  checkOllamaConnection: () => Promise.resolve(true),
}));

const mockIsLocalLLMEnabled = mock(() => false);
const mockEnsureLocalLLM = mock(() =>
  Promise.resolve({ url: 'http://local', model: 'local-model' }),
);
mock.module('../../services/local-llm', () => ({
  isLocalLLMEnabled: mockIsLocalLLMEnabled,
  ensureLocalLLM: mockEnsureLocalLLM,
}));

mock.module('../../config', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const mockBuildRAGContext = mock(() =>
  Promise.resolve({ query: '', entries: [], contextText: '' }),
);
mock.module('../../services/memory/rag/context-builder', () => ({
  buildRAGContext: mockBuildRAGContext,
}));

const mockIncrementLlmCall = mock(() => {});
mock.module('../llm-call-context', () => ({
  incrementLlmCall: mockIncrementLlmCall,
}));

const mockGetCachedResponse = mock(() => null as { content: string; tokensUsed: number } | null);
const mockSetCachedResponse = mock(() => {});
mock.module('../../services/local-llm/response-cache', () => ({
  generateCacheKey: () => 'cache-key',
  getCachedResponse: mockGetCachedResponse,
  setCachedResponse: mockSetCachedResponse,
}));

const { sendAIMessage, sendAIMessageStream, getAuxAiMode } = await import('./index');

const originalAuxAi = process.env.RAPITAS_AUX_AI;
afterEach(() => {
  if (originalAuxAi === undefined) delete process.env.RAPITAS_AUX_AI;
  else process.env.RAPITAS_AUX_AI = originalAuxAi;
  mockIsLocalLLMEnabled.mockReturnValue(false);
  mockGetCachedResponse.mockReturnValue(null);
});

describe('getAuxAiMode', () => {
  test('defaults to cli when unset', () => {
    delete process.env.RAPITAS_AUX_AI;
    expect(getAuxAiMode()).toBe('cli');
  });

  test('returns api when set to api', () => {
    process.env.RAPITAS_AUX_AI = 'api';
    expect(getAuxAiMode()).toBe('api');
  });

  test('returns off when set to off', () => {
    process.env.RAPITAS_AUX_AI = 'off';
    expect(getAuxAiMode()).toBe('off');
  });

  test('is case-insensitive', () => {
    process.env.RAPITAS_AUX_AI = 'API';
    expect(getAuxAiMode()).toBe('api');
  });

  test('falls back to cli for an unrecognized value', () => {
    process.env.RAPITAS_AUX_AI = 'bogus';
    expect(getAuxAiMode()).toBe('cli');
  });
});

describe('sendAIMessage', () => {
  test('throws when RAPITAS_AUX_AI=off', async () => {
    process.env.RAPITAS_AUX_AI = 'off';
    await expect(sendAIMessage({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(
      '補助AI機能は無効化されています',
    );
  });

  test('delegates to the CLI in the default (cli) mode', async () => {
    delete process.env.RAPITAS_AUX_AI;
    mockCallClaudeCli.mockClear();
    const result = await sendAIMessage({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result).toEqual({ content: 'cli reply', tokensUsed: 5 });
    expect(mockCallClaudeCli).toHaveBeenCalledTimes(1);
  });

  test('uses the paid claude provider in api mode', async () => {
    process.env.RAPITAS_AUX_AI = 'api';
    mockCallClaude.mockClear();
    const result = await sendAIMessage({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toEqual({ content: 'claude reply', tokensUsed: 10 });
    expect(mockCallClaude).toHaveBeenCalledTimes(1);
  });

  test('uses the paid chatgpt provider in api mode', async () => {
    process.env.RAPITAS_AUX_AI = 'api';
    const result = await sendAIMessage({
      provider: 'chatgpt',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toEqual({ content: 'gpt reply', tokensUsed: 8 });
  });

  test('uses the paid gemini provider in api mode', async () => {
    process.env.RAPITAS_AUX_AI = 'api';
    const result = await sendAIMessage({
      provider: 'gemini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toEqual({ content: 'gemini reply', tokensUsed: 7 });
  });

  test('throws a Japanese "no API key" error when the key is missing', async () => {
    process.env.RAPITAS_AUX_AI = 'api';
    mockGetApiKeyForProvider.mockResolvedValueOnce(null);
    await expect(
      sendAIMessage({ provider: 'claude', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('APIキーが設定されていません');
  });

  test('ollama provider falls back to non-local when local LLM is disabled', async () => {
    process.env.RAPITAS_AUX_AI = 'cli';
    mockIsLocalLLMEnabled.mockReturnValue(false);
    mockCallClaudeCli.mockClear();
    const result = await sendAIMessage({
      provider: 'ollama',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toEqual({ content: 'cli reply', tokensUsed: 5 });
    expect(mockCallClaudeCli).toHaveBeenCalledTimes(1);
  });

  test('ollama provider calls Ollama directly when enabled and cache misses', async () => {
    mockIsLocalLLMEnabled.mockReturnValue(true);
    mockGetCachedResponse.mockReturnValue(null);
    mockCallOllama.mockClear();
    mockSetCachedResponse.mockClear();
    const result = await sendAIMessage({
      provider: 'ollama',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toEqual({ content: 'ollama reply', tokensUsed: 3 });
    expect(mockCallOllama).toHaveBeenCalledTimes(1);
    expect(mockSetCachedResponse).toHaveBeenCalledTimes(1);
  });

  test('ollama provider returns the cached response on a cache hit without calling Ollama', async () => {
    mockIsLocalLLMEnabled.mockReturnValue(true);
    mockGetCachedResponse.mockReturnValue({ content: 'from cache', tokensUsed: 1 });
    mockCallOllama.mockClear();
    const result = await sendAIMessage({
      provider: 'ollama',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toEqual({ content: 'from cache', tokensUsed: 1 });
    expect(mockCallOllama).not.toHaveBeenCalled();
  });

  test('ollama provider skips the cache entirely when skipCache is set', async () => {
    mockIsLocalLLMEnabled.mockReturnValue(true);
    mockGetCachedResponse.mockClear();
    mockCallOllama.mockClear();
    const result = await sendAIMessage({
      provider: 'ollama',
      messages: [{ role: 'user', content: 'hi' }],
      skipCache: true,
    });
    expect(result).toEqual({ content: 'ollama reply', tokensUsed: 3 });
    expect(mockGetCachedResponse).not.toHaveBeenCalled();
  });

  test('ollama provider falls back to non-local on error', async () => {
    process.env.RAPITAS_AUX_AI = 'cli';
    mockIsLocalLLMEnabled.mockReturnValue(true);
    mockEnsureLocalLLM.mockImplementationOnce(() => Promise.reject(new Error('ollama down')));
    mockCallClaudeCli.mockClear();
    const result = await sendAIMessage({
      provider: 'ollama',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toEqual({ content: 'cli reply', tokensUsed: 5 });
    expect(mockCallClaudeCli).toHaveBeenCalledTimes(1);
  });

  test('ollama + enableRAG injects RAG context into the system prompt', async () => {
    mockIsLocalLLMEnabled.mockReturnValue(true);
    mockGetCachedResponse.mockReturnValue(null);
    mockBuildRAGContext.mockResolvedValueOnce({
      query: 'hi',
      entries: [{ id: 1 }],
      contextText: 'relevant knowledge',
    });
    mockCallOllama.mockClear();
    await sendAIMessage({
      provider: 'ollama',
      messages: [{ role: 'user', content: 'hi' }],
      enableRAG: true,
    });
    const [, , , systemPromptArg] = mockCallOllama.mock.calls[0];
    expect(systemPromptArg).toContain('relevant knowledge');
  });

  test('unsupported provider in api mode throws', async () => {
    process.env.RAPITAS_AUX_AI = 'api';
    await expect(
      sendAIMessage({
        provider: 'bogus' as never,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toThrow();
  });
});

describe('sendAIMessageStream', () => {
  test('throws when RAPITAS_AUX_AI=off', async () => {
    process.env.RAPITAS_AUX_AI = 'off';
    await expect(
      sendAIMessageStream({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('補助AI機能は無効化されています');
  });

  test('delegates to the CLI stream in the default (cli) mode', async () => {
    delete process.env.RAPITAS_AUX_AI;
    const result = await sendAIMessageStream({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result).toBeInstanceOf(ReadableStream);
  });

  test('ollama stream falls back to non-local when disabled', async () => {
    mockIsLocalLLMEnabled.mockReturnValue(false);
    const result = await sendAIMessageStream({
      provider: 'ollama',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toBeInstanceOf(ReadableStream);
  });

  test('api mode streams from the paid claude provider', async () => {
    process.env.RAPITAS_AUX_AI = 'api';
    const result = await sendAIMessageStream({
      provider: 'claude',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result).toBeInstanceOf(ReadableStream);
  });
});
