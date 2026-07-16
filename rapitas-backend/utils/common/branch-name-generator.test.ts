/**
 * branch-name-generator ユニットテスト
 *
 * 純粋関数群（extractBranchName / sanitizeBranchName / assertSafeGitRef /
 * isValidBranchName / generateFallbackBranchName）を実実装で固定し、
 * generateBranchName の AI 呼び出し成功・失敗（フォールバック）経路を
 * ../ai-client のモックで検証する。
 */
import { describe, test, expect, mock } from 'bun:test';

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const mockSendAIMessage = mock(() =>
  Promise.resolve({ content: 'feature/add-user-authentication', tokensUsed: 0 }),
) as ReturnType<typeof mock>;

mock.module('../ai-client', () => ({
  sendAIMessage: mockSendAIMessage,
  sendAIMessageStream: mock(() => Promise.resolve(new ReadableStream())),
  getAuxAiMode: mock(() => 'cli'),
  isValidApiKeyFormat: mock(() => true),
  getApiKeyForProvider: mock(() => Promise.resolve(null)),
  getDefaultModel: mock(() => 'claude-model'),
  getDefaultProvider: mock(() => Promise.resolve('claude')),
  isAnyApiKeyConfigured: mock(() => Promise.resolve(true)),
  getConfiguredProviders: mock(() => Promise.resolve([])),
  getOllamaUrl: mock(() => 'http://localhost:11434'),
  formatApiError: mock(() => 'error'),
  handleApiError: mock(() => ({ content: '', tokensUsed: 0 })),
  callClaude: mock(() => Promise.resolve({ content: '', tokensUsed: 0 })),
  callClaudeStream: mock(() => Promise.resolve(new ReadableStream())),
  callClaudeCli: mock(() => Promise.resolve({ content: '', tokensUsed: 0 })),
  callClaudeCliStream: mock(() => Promise.resolve(new ReadableStream())),
  isClaudeCliAvailable: mock(() => Promise.resolve(true)),
  callChatGPT: mock(() => Promise.resolve({ content: '', tokensUsed: 0 })),
  callChatGPTStream: mock(() => Promise.resolve(new ReadableStream())),
  callGemini: mock(() => Promise.resolve({ content: '', tokensUsed: 0 })),
  callGeminiStream: mock(() => Promise.resolve(new ReadableStream())),
  callOllama: mock(() => Promise.resolve({ content: '', tokensUsed: 0 })),
  callOllamaStream: mock(() => Promise.resolve(new ReadableStream())),
  checkOllamaConnection: mock(() => Promise.resolve(true)),
  PROVIDER_NAMES: { claude: 'Claude', chatgpt: 'ChatGPT', gemini: 'Gemini', ollama: 'Ollama' },
}));

import {
  generateBranchName,
  extractBranchName,
  sanitizeBranchName,
  assertSafeGitRef,
  isValidBranchName,
  generateFallbackBranchName,
} from './branch-name-generator';

describe('extractBranchName', () => {
  test('passes through a clean branch name unchanged', () => {
    expect(extractBranchName('feature/add-user-authentication')).toBe(
      'feature/add-user-authentication',
    );
  });

  test('strips markdown code fences', () => {
    expect(extractBranchName('```\nfeature/add-auth\n```')).toBe('feature/add-auth');
  });

  test('strips surrounding backticks', () => {
    expect(extractBranchName('`feature/add-auth`')).toBe('feature/add-auth');
  });

  test('takes only the first line when the LLM appends explanatory text', () => {
    expect(extractBranchName('feature/add-auth\nThis adds authentication.')).toBe(
      'feature/add-auth',
    );
  });

  test('removes surrounding quotes', () => {
    expect(extractBranchName('"feature/add-auth"')).toBe('feature/add-auth');
  });

  test('removes a "branch name:" style prefix', () => {
    expect(extractBranchName('Branch name: feature/add-auth')).toBe('feature/add-auth');
  });

  test('normalizes fix/ to bugfix/', () => {
    expect(extractBranchName('fix/login-button')).toBe('bugfix/login-button');
  });

  test('prepends feature/ when no valid prefix is present', () => {
    expect(extractBranchName('add-user-authentication')).toBe('feature/add-user-authentication');
  });

  test('inserts "implement-" when the slug after the prefix has no hyphen', () => {
    expect(extractBranchName('feature/auth')).toBe('feature/implement-auth');
  });
});

describe('sanitizeBranchName', () => {
  test('lowercases the input', () => {
    expect(sanitizeBranchName('Feature/Add-Auth')).toBe('feature/add-auth');
  });

  test('replaces disallowed characters with hyphens', () => {
    expect(sanitizeBranchName('feature/add auth!!')).toBe('feature/add-auth');
  });

  test('collapses consecutive hyphens', () => {
    expect(sanitizeBranchName('feature/add---auth')).toBe('feature/add-auth');
  });

  test('strips leading and trailing hyphens', () => {
    expect(sanitizeBranchName('-feature/add-auth-')).toBe('feature/add-auth');
  });

  test('truncates to 50 characters', () => {
    const long = 'feature/' + 'a'.repeat(60);
    const result = sanitizeBranchName(long);
    expect(result.length).toBeLessThanOrEqual(50);
  });
});

describe('assertSafeGitRef', () => {
  test('accepts a well-formed branch name', () => {
    expect(() => assertSafeGitRef('feature/add-auth')).not.toThrow();
  });

  test('rejects an empty string', () => {
    expect(() => assertSafeGitRef('')).toThrow();
  });

  test('rejects a value longer than 200 characters', () => {
    expect(() => assertSafeGitRef('a'.repeat(201))).toThrow();
  });

  test('rejects shell metacharacters', () => {
    expect(() => assertSafeGitRef('feature/add; rm -rf /')).toThrow();
  });

  test('rejects path traversal', () => {
    expect(() => assertSafeGitRef('feature/../../etc/passwd')).toThrow();
  });

  test('rejects a leading hyphen (git option injection)', () => {
    expect(() => assertSafeGitRef('--force')).toThrow();
  });

  test('includes the field name in the error message', () => {
    expect(() => assertSafeGitRef('', 'baseBranch')).toThrow(/baseBranch/);
  });
});

describe('isValidBranchName', () => {
  test('accepts a valid feature branch name', () => {
    expect(isValidBranchName('feature/add-user-auth')).toBe(true);
  });

  test('rejects an empty name', () => {
    expect(isValidBranchName('')).toBe(false);
  });

  test('rejects a name over 50 characters', () => {
    expect(isValidBranchName('feature/' + 'a-'.repeat(30))).toBe(false);
  });

  test('rejects a name without a recognized prefix', () => {
    expect(isValidBranchName('add-user-auth')).toBe(false);
  });

  test('rejects a single-word slug (no hyphen after the prefix)', () => {
    expect(isValidBranchName('feature/auth')).toBe(false);
  });

  test('rejects names containing special characters', () => {
    expect(isValidBranchName('feature/add~auth')).toBe(false);
  });

  test('rejects consecutive dots', () => {
    expect(isValidBranchName('feature/add..auth')).toBe(false);
  });

  test('rejects a leading dot', () => {
    expect(isValidBranchName('.feature/add-auth')).toBe(false);
  });

  test('rejects a trailing hyphen', () => {
    expect(isValidBranchName('feature/add-auth-')).toBe(false);
  });
});

describe('generateFallbackBranchName', () => {
  test('generates a feature/ branch for a generic task title', () => {
    const name = generateFallbackBranchName('Add dashboard charts');
    expect(name).toMatch(/^feature\//);
    expect(isValidBranchName(name)).toBe(true);
  });

  test('generates a bugfix/ branch when the title contains a bug keyword', () => {
    const name = generateFallbackBranchName('Fix login button error');
    expect(name).toMatch(/^bugfix\//);
  });

  test('generates a bugfix/ branch for a Japanese bug keyword', () => {
    const name = generateFallbackBranchName('ログインボタンのバグ修正');
    expect(name).toMatch(/^bugfix\//);
  });

  test('generates a chore/ branch when the title contains a chore keyword', () => {
    const name = generateFallbackBranchName('Update dependencies');
    expect(name).toMatch(/^chore\//);
  });

  test('falls back to "task" when the title has no usable characters', () => {
    const name = generateFallbackBranchName('!!!');
    expect(name).toBe('feature/implement-task');
  });

  test('always produces a name that passes isValidBranchName', () => {
    const titles = ['', '   ', '日本語のみのタスク', 'A', 'Refactor the whole auth module now'];
    for (const title of titles) {
      expect(isValidBranchName(generateFallbackBranchName(title))).toBe(true);
    }
  });
});

describe('generateBranchName', () => {
  test('returns the AI-generated branch name when the response is valid', async () => {
    mockSendAIMessage.mockImplementationOnce(() =>
      Promise.resolve({ content: 'feature/add-user-authentication', tokensUsed: 10 }),
    );
    const name = await generateBranchName('Add user authentication');
    expect(name).toBe('feature/add-user-authentication');
  });

  test('falls back to a generated name when the AI call rejects', async () => {
    mockSendAIMessage.mockImplementationOnce(() => Promise.reject(new Error('AI unavailable')));
    const name = await generateBranchName('Fix login button error');
    expect(name).toMatch(/^bugfix\//);
    expect(isValidBranchName(name)).toBe(true);
  });

  test('falls back to a generated name when the AI response is unusable (empty)', async () => {
    mockSendAIMessage.mockImplementationOnce(() => Promise.resolve({ content: '', tokensUsed: 0 }));
    const name = await generateBranchName('Update dependencies');
    expect(name).toMatch(/^chore\//);
    expect(isValidBranchName(name)).toBe(true);
  });
});
