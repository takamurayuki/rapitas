import { describe, test, expect, mock, afterEach } from 'bun:test';

const mockCheckOllamaConnection = mock(() =>
  Promise.resolve({ connected: false, models: [] as string[], error: 'not connected' }),
);
mock.module('../../utils/ai-client/ollama-provider', () => ({
  checkOllamaConnection: mockCheckOllamaConnection,
}));

const mockIsModelDownloaded = mock(() => false);
const mockIsLlamaServerDownloaded = mock(() => false);
const mockGetModelPath = mock(() => '/fake/model/path.gguf');
const mockGetLlamaServerPath = mock(() => '/fake/llama-server');
const mockDownloadLlamaServer = mock(() =>
  Promise.resolve({ success: false, error: 'download failed', path: '' }),
);
mock.module('./model-downloader', () => ({
  getModelPath: mockGetModelPath,
  isModelDownloaded: mockIsModelDownloaded,
  getLlamaServerPath: mockGetLlamaServerPath,
  isLlamaServerDownloaded: mockIsLlamaServerDownloaded,
  downloadLlamaServer: mockDownloadLlamaServer,
}));

mock.module('../../config', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { isLocalLLMEnabled, getLocalLLMStatus, ensureLocalLLM, stopLlamaServer, cleanupLocalLLM } =
  await import('./local-llm-manager');

const originalEnabled = process.env.RAPITAS_ENABLE_LOCAL_LLM;
afterEach(() => {
  if (originalEnabled === undefined) delete process.env.RAPITAS_ENABLE_LOCAL_LLM;
  else process.env.RAPITAS_ENABLE_LOCAL_LLM = originalEnabled;
  mockCheckOllamaConnection.mockReset();
  mockCheckOllamaConnection.mockResolvedValue({
    connected: false,
    models: [],
    error: 'not connected',
  });
  mockIsModelDownloaded.mockReset();
  mockIsModelDownloaded.mockReturnValue(false);
});

describe('isLocalLLMEnabled', () => {
  test('defaults to disabled when unset', () => {
    delete process.env.RAPITAS_ENABLE_LOCAL_LLM;
    expect(isLocalLLMEnabled()).toBe(false);
  });

  test.each(['1', 'true', 'yes', 'on', 'TRUE', 'On'])('is enabled for "%s"', (v) => {
    process.env.RAPITAS_ENABLE_LOCAL_LLM = v;
    expect(isLocalLLMEnabled()).toBe(true);
  });

  test.each(['0', 'false', 'no', 'off', ''])('is disabled for "%s"', (v) => {
    process.env.RAPITAS_ENABLE_LOCAL_LLM = v;
    expect(isLocalLLMEnabled()).toBe(false);
  });
});

describe('getLocalLLMStatus', () => {
  test('reports unavailable without checking Ollama when the kill-switch is off', async () => {
    delete process.env.RAPITAS_ENABLE_LOCAL_LLM;
    mockCheckOllamaConnection.mockClear();
    const status = await getLocalLLMStatus();
    expect(status.available).toBe(false);
    expect(status.source).toBe('none');
    expect(mockCheckOllamaConnection).not.toHaveBeenCalled();
  });

  test('reports available via ollama when connected', async () => {
    process.env.RAPITAS_ENABLE_LOCAL_LLM = '1';
    mockCheckOllamaConnection.mockResolvedValueOnce({
      connected: true,
      models: ['qwen2.5:0.5b', 'llama3'],
    });
    const status = await getLocalLLMStatus('http://localhost:11434');
    expect(status.available).toBe(true);
    expect(status.source).toBe('ollama');
    expect(status.model).toBe('qwen2.5:0.5b');
    expect(status.models).toEqual(['qwen2.5:0.5b', 'llama3']);
  });

  test('reports unavailable with an error when neither ollama nor llama-server connect', async () => {
    process.env.RAPITAS_ENABLE_LOCAL_LLM = '1';
    mockCheckOllamaConnection.mockResolvedValueOnce({
      connected: false,
      models: [],
      error: 'connection refused',
    });
    const status = await getLocalLLMStatus();
    expect(status.available).toBe(false);
    expect(status.source).toBe('none');
    expect(status.error).toBe('connection refused');
  });

  test('reflects modelDownloaded from the model-downloader', async () => {
    delete process.env.RAPITAS_ENABLE_LOCAL_LLM;
    mockIsModelDownloaded.mockReturnValue(true);
    const status = await getLocalLLMStatus();
    expect(status.modelDownloaded).toBe(true);
  });
});

describe('ensureLocalLLM', () => {
  test('throws when the kill-switch is off', async () => {
    delete process.env.RAPITAS_ENABLE_LOCAL_LLM;
    await expect(ensureLocalLLM()).rejects.toThrow('ローカルLLMは無効です');
  });

  test('uses Ollama directly when connected, preferring the requested model if available', async () => {
    process.env.RAPITAS_ENABLE_LOCAL_LLM = '1';
    mockCheckOllamaConnection.mockResolvedValueOnce({
      connected: true,
      models: ['qwen2.5:0.5b', 'llama3'],
    });
    const result = await ensureLocalLLM('http://localhost:11434', 'llama3');
    expect(result).toEqual({ url: 'http://localhost:11434', model: 'llama3' });
  });

  test('falls back to a qwen-named model when the preferred model is unavailable', async () => {
    process.env.RAPITAS_ENABLE_LOCAL_LLM = '1';
    mockCheckOllamaConnection.mockResolvedValueOnce({
      connected: true,
      models: ['qwen2.5:0.5b', 'llama3'],
    });
    const result = await ensureLocalLLM('http://localhost:11434', 'not-installed-model');
    expect(result.model).toBe('qwen2.5:0.5b');
  });

  test('throws a Japanese "model not downloaded" error when ollama is down and no model exists', async () => {
    process.env.RAPITAS_ENABLE_LOCAL_LLM = '1';
    mockCheckOllamaConnection.mockResolvedValueOnce({
      connected: false,
      models: [],
      error: 'down',
    });
    mockIsModelDownloaded.mockReturnValue(false);
    await expect(ensureLocalLLM()).rejects.toThrow('ローカルLLMモデルがダウンロードされていません');
  });
});

describe('stopLlamaServer / cleanupLocalLLM', () => {
  test('stopLlamaServer does not throw when no server is running', () => {
    expect(() => stopLlamaServer()).not.toThrow();
  });

  test('cleanupLocalLLM does not throw', () => {
    expect(() => cleanupLocalLLM()).not.toThrow();
  });
});
