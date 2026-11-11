/**
 * index.cli-route.test
 *
 * sendAIMessage's CLI-mode routing (routing2b): only an explicit
 * `cliRoute: 'codex'` reaches the Codex CLI; the provider name never does, so
 * a chat that picks `chatgpt` keeps going to the Claude CLI. Both providers
 * are mocked at their module boundary.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';

const mockCallClaudeCli = mock(() => Promise.resolve({ content: 'claude-cli', tokensUsed: 1 }));
mock.module('./claude-cli-provider', () => ({
  callClaudeCli: mockCallClaudeCli,
  callClaudeCliStream: mock(() => Promise.resolve(new ReadableStream())),
  isClaudeCliAvailable: () => Promise.resolve(true),
}));
const mockCallCodexCli = mock(() => Promise.resolve({ content: 'codex-cli', tokensUsed: 2 }));
mock.module('./codex-cli-provider', () => ({
  callCodexCli: mockCallCodexCli,
  getCodexCliStatus: () => Promise.resolve('ready'),
  isCodexCliAvailable: () => Promise.resolve(true),
  buildCodexAuxArgs: () => [],
  buildCodexAuxEnv: () => ({}),
  CODEX_AUX_DISABLED_FEATURES: [],
  CODEX_AUX_PREAMBLE: '',
  __resetCodexCliStatusForTests: () => {},
}));
const mockCallChatGPT = mock(() => Promise.resolve({ content: 'paid-gpt', tokensUsed: 3 }));
mock.module('./chatgpt-provider', () => ({
  callChatGPT: mockCallChatGPT,
  callChatGPTStream: mock(() => Promise.resolve(new ReadableStream())),
}));
mock.module('./credentials', () => ({
  getApiKeyForProvider: () => Promise.resolve('sk-key'),
  getDefaultModel: () => Promise.resolve('m'),
  getDefaultProvider: () => Promise.resolve('claude'),
  isAnyApiKeyConfigured: () => Promise.resolve(true),
  getConfiguredProviders: () => Promise.resolve(['claude']),
  getOllamaUrl: () => Promise.resolve('http://localhost:11434'),
  isValidApiKeyFormat: () => true,
}));
mock.module('../../services/local-llm', () => ({
  isLocalLLMEnabled: () => false,
  ensureLocalLLM: () => Promise.resolve({ url: '', model: '' }),
}));
mock.module('../../config', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

const { sendAIMessage } = await import('./index');
const messages = [{ role: 'user' as const, content: 'review this' }];

afterEach(() => {
  delete process.env.RAPITAS_AUX_AI;
  mockCallClaudeCli.mockClear();
  mockCallCodexCli.mockClear();
  mockCallChatGPT.mockClear();
});

describe('sendAIMessage cliRoute (cli mode)', () => {
  test("cliRoute 'codex' goes to the Codex CLI with the seat's model", async () => {
    const res = await sendAIMessage({
      provider: 'chatgpt',
      model: 'gpt-6-astra',
      cliRoute: 'codex',
      messages,
      systemPrompt: 'sys',
      maxTokens: 2000,
    });
    expect(res.content).toBe('codex-cli');
    expect(mockCallCodexCli).toHaveBeenCalledWith('gpt-6-astra', messages, 'sys', 2000, undefined);
    expect(mockCallClaudeCli).not.toHaveBeenCalled();
  });

  test("provider 'chatgpt' without cliRoute still goes to the Claude CLI (chat unchanged)", async () => {
    const res = await sendAIMessage({ provider: 'chatgpt', model: 'gpt-4o', messages });
    expect(res.content).toBe('claude-cli');
    expect(mockCallCodexCli).not.toHaveBeenCalled();
  });

  test("cliRoute 'claude' is the Claude CLI", async () => {
    await sendAIMessage({ provider: 'claude', model: 'opus', cliRoute: 'claude', messages });
    expect(mockCallClaudeCli).toHaveBeenCalledTimes(1);
    expect(mockCallCodexCli).not.toHaveBeenCalled();
  });

  test('a Codex failure surfaces to the caller (no silent Claude fallback)', async () => {
    mockCallCodexCli.mockImplementationOnce(() => Promise.reject(new Error('usage limit')));
    await expect(
      sendAIMessage({ provider: 'chatgpt', model: 'gpt-6-astra', cliRoute: 'codex', messages }),
    ).rejects.toThrow('usage limit');
    expect(mockCallClaudeCli).not.toHaveBeenCalled();
  });

  test('api mode ignores cliRoute and uses the paid provider', async () => {
    process.env.RAPITAS_AUX_AI = 'api';
    const res = await sendAIMessage({
      provider: 'chatgpt',
      model: 'gpt-6-astra',
      cliRoute: 'codex',
      messages,
    });
    expect(res.content).toBe('paid-gpt');
    expect(mockCallCodexCli).not.toHaveBeenCalled();
  });
});
