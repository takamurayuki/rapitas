/**
 * credentials.test
 *
 * Covers API-key format validation, DB-first/env-fallback key resolution,
 * Ollama URL resolution, default model/provider lookup, and the aggregate
 * "which providers are configured" helpers. Mocks config/database,
 * config/logger, and utils/common/secret-store in full (bun's mock.module is
 * process-global, so every real export of a mocked module must be mirrored
 * or unrelated test files importing the same module later will break).
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

type SettingsShape = {
  claudeApiKeyEncrypted: string | null;
  chatgptApiKeyEncrypted: string | null;
  geminiApiKeyEncrypted: string | null;
  claudeDefaultModel: string | null;
  chatgptDefaultModel: string | null;
  geminiDefaultModel: string | null;
  ollamaDefaultModel: string | null;
  ollamaUrl: string | null;
  defaultAiProvider: string | null;
};

const mockSettings: SettingsShape = {
  claudeApiKeyEncrypted: null,
  chatgptApiKeyEncrypted: null,
  geminiApiKeyEncrypted: null,
  claudeDefaultModel: null,
  chatgptDefaultModel: null,
  geminiDefaultModel: null,
  ollamaDefaultModel: null,
  ollamaUrl: null,
  defaultAiProvider: null,
};

const mockFindFirst = mock(() => Promise.resolve<SettingsShape | null>(mockSettings));
mock.module('../../config/database', () => ({
  prisma: { userSettings: { findFirst: mockFindFirst } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const noopLog = {
  info: () => {},
  warn: mock(() => {}),
  error: () => {},
  debug: () => {},
  child: () => noopLog,
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLog,
  logger: noopLog,
  getBackendLogFilePath: () => '/tmp/fake.log',
}));

const mockResolveStoredSecret = mock((v: string | null | undefined) => v ?? null);
mock.module('../common/secret-store', () => ({
  isKeychainSecretRef: () => false,
  saveProviderApiKey: mock(() => 'encrypted'),
  saveAgentApiKey: mock(() => 'encrypted'),
  saveSecret: mock(() => 'encrypted'),
  resolveStoredSecret: mockResolveStoredSecret,
  deleteStoredSecret: mock(() => {}),
  maskStoredSecret: mock(() => null),
}));

const {
  isValidApiKeyFormat,
  getApiKeyForProvider,
  getOllamaUrl,
  getDefaultModel,
  getDefaultProvider,
  isAnyApiKeyConfigured,
  getConfiguredProviders,
} = await import('./credentials');

function resetSettings(): void {
  mockSettings.claudeApiKeyEncrypted = null;
  mockSettings.chatgptApiKeyEncrypted = null;
  mockSettings.geminiApiKeyEncrypted = null;
  mockSettings.claudeDefaultModel = null;
  mockSettings.chatgptDefaultModel = null;
  mockSettings.geminiDefaultModel = null;
  mockSettings.ollamaDefaultModel = null;
  mockSettings.ollamaUrl = null;
  mockSettings.defaultAiProvider = null;
}

beforeEach(() => {
  resetSettings();
  mockFindFirst.mockReset().mockReturnValue(Promise.resolve(mockSettings));
  mockResolveStoredSecret
    .mockReset()
    .mockImplementation((v: string | null | undefined) => v ?? null);
  noopLog.warn.mockReset();
  delete (process.env as Record<string, string | undefined>).CLAUDE_API_KEY;
});

afterEach(() => {
  delete (process.env as Record<string, string | undefined>).CLAUDE_API_KEY;
});

describe('isValidApiKeyFormat', () => {
  it('rejects keys shorter than 10 characters', () => {
    expect(isValidApiKeyFormat('short', 'claude')).toBe(false);
  });

  it('rejects blank/whitespace-only keys', () => {
    expect(isValidApiKeyFormat('   ', 'claude')).toBe(false);
  });

  it('requires the sk-ant-api prefix for claude', () => {
    expect(isValidApiKeyFormat('sk-ant-api03-abcdefghij', 'claude')).toBe(true);
    expect(isValidApiKeyFormat('sk-not-claude-abcdefghij', 'claude')).toBe(false);
  });

  it('accepts sk- prefixed keys for chatgpt but excludes claude-shaped keys', () => {
    expect(isValidApiKeyFormat('sk-abcdefghijklmnop', 'chatgpt')).toBe(true);
    expect(isValidApiKeyFormat('sk-ant-api03-abcdefghij', 'chatgpt')).toBe(false);
  });

  it('requires the AIza prefix for gemini', () => {
    expect(isValidApiKeyFormat('AIzaSyABCDEFGHIJ', 'gemini')).toBe(true);
    expect(isValidApiKeyFormat('wrong-prefix-key-1234', 'gemini')).toBe(false);
  });

  it('accepts any sufficiently long key for unrecognized providers (default branch)', () => {
    expect(isValidApiKeyFormat('anything-long-enough', 'ollama')).toBe(true);
  });
});

describe('getApiKeyForProvider', () => {
  it('returns the Ollama URL (not an API key) for the ollama provider', async () => {
    mockSettings.ollamaUrl = 'http://custom:1234';
    const result = await getApiKeyForProvider('ollama');
    expect(result).toBe('http://custom:1234');
  });

  it('returns the decrypted DB key when it is valid', async () => {
    mockSettings.claudeApiKeyEncrypted = 'stored';
    mockResolveStoredSecret.mockReturnValue('sk-ant-api03-abcdefghij');
    const result = await getApiKeyForProvider('claude');
    expect(result).toBe('sk-ant-api03-abcdefghij');
  });

  it('falls back to env var when the DB key has an invalid format', async () => {
    mockSettings.claudeApiKeyEncrypted = 'stored';
    mockResolveStoredSecret.mockReturnValue('not-a-valid-shape-key');
    process.env.CLAUDE_API_KEY = 'sk-ant-api03-envkeylongenough';
    const result = await getApiKeyForProvider('claude');
    expect(result).toBe('sk-ant-api03-envkeylongenough');
    expect(noopLog.warn).toHaveBeenCalled();
  });

  it('falls back to env var when decryption throws', async () => {
    mockSettings.claudeApiKeyEncrypted = 'stored';
    mockResolveStoredSecret.mockImplementation(() => {
      throw new Error('decrypt failed');
    });
    process.env.CLAUDE_API_KEY = 'sk-ant-api03-envkeylongenough';
    const result = await getApiKeyForProvider('claude');
    expect(result).toBe('sk-ant-api03-envkeylongenough');
    expect(noopLog.warn).toHaveBeenCalled();
  });

  it('does not fall back to env for chatgpt/gemini (claude-only fallback)', async () => {
    mockSettings.chatgptApiKeyEncrypted = null;
    const result = await getApiKeyForProvider('chatgpt');
    expect(result).toBeNull();
  });

  it('returns null when no settings row exists and no env var is set', async () => {
    mockFindFirst.mockReturnValue(Promise.resolve(null));
    const result = await getApiKeyForProvider('claude');
    expect(result).toBeNull();
  });

  it('returns null and warns when the env var itself has an invalid format', async () => {
    mockFindFirst.mockReturnValue(Promise.resolve(null));
    process.env.CLAUDE_API_KEY = 'not-valid-shape';
    const result = await getApiKeyForProvider('claude');
    expect(result).toBeNull();
    expect(noopLog.warn).toHaveBeenCalled();
  });
});

describe('getOllamaUrl', () => {
  it('returns the DB-configured URL when present', async () => {
    mockSettings.ollamaUrl = 'http://db-configured:9999';
    expect(await getOllamaUrl()).toBe('http://db-configured:9999');
  });

  it('falls back to the default local URL when unset', async () => {
    expect(await getOllamaUrl()).toBe('http://localhost:11434');
  });

  it('falls back to the default local URL when there is no settings row', async () => {
    mockFindFirst.mockReturnValue(Promise.resolve(null));
    expect(await getOllamaUrl()).toBe('http://localhost:11434');
  });
});

describe('getDefaultModel', () => {
  it('returns the DB-configured model when present', async () => {
    mockSettings.geminiDefaultModel = 'gemini-custom';
    expect(await getDefaultModel('gemini')).toBe('gemini-custom');
  });

  it('falls back to the built-in default per provider', async () => {
    expect(await getDefaultModel('claude')).toBe('claude-sonnet-4-20250514');
    expect(await getDefaultModel('chatgpt')).toBe('gpt-4o');
    expect(await getDefaultModel('ollama')).toBe('gemma3:4b');
  });

  it('falls back to the built-in default when there is no settings row', async () => {
    mockFindFirst.mockReturnValue(Promise.resolve(null));
    expect(await getDefaultModel('claude')).toBe('claude-sonnet-4-20250514');
  });
});

describe('getDefaultProvider', () => {
  it('returns the DB-configured provider', async () => {
    mockSettings.defaultAiProvider = 'gemini';
    expect(await getDefaultProvider()).toBe('gemini');
  });

  it('defaults to claude when unset', async () => {
    expect(await getDefaultProvider()).toBe('claude');
  });

  it('defaults to claude when there is no settings row', async () => {
    mockFindFirst.mockReturnValue(Promise.resolve(null));
    expect(await getDefaultProvider()).toBe('claude');
  });
});

describe('isAnyApiKeyConfigured', () => {
  it('returns true when the default provider has a valid key', async () => {
    mockSettings.defaultAiProvider = 'claude';
    mockSettings.claudeApiKeyEncrypted = 'stored';
    mockResolveStoredSecret.mockReturnValue('sk-ant-api03-abcdefghij');
    expect(await isAnyApiKeyConfigured()).toBe(true);
  });

  it('returns false when the default provider has no key', async () => {
    mockSettings.defaultAiProvider = 'chatgpt';
    expect(await isAnyApiKeyConfigured()).toBe(false);
  });
});

describe('getConfiguredProviders', () => {
  it('includes only providers with a resolvable key, plus ollama always', async () => {
    mockSettings.claudeApiKeyEncrypted = 'stored';
    mockSettings.geminiApiKeyEncrypted = 'stored';
    mockResolveStoredSecret.mockImplementation((v: string | null | undefined) => {
      if (v === 'stored') return 'sk-ant-api03-abcdefghij';
      return null;
    });
    // NOTE: gemini's mocked decrypted value won't pass the AIza-prefix check,
    // so only claude qualifies here — this also exercises the per-provider
    // format-mismatch branch inside getApiKeyForProvider.
    const result = await getConfiguredProviders();
    expect(result).toContain('claude');
    expect(result).not.toContain('gemini');
    expect(result).toContain('ollama');
  });

  it('returns only ollama when nothing is configured', async () => {
    const result = await getConfiguredProviders();
    expect(result).toEqual(['ollama']);
  });
});
