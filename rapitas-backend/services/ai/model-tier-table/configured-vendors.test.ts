/**
 * configured-vendors テスト
 *
 * 「設定済みで使えるベンダー」を実際の構成から求めることを固定する: API モードは
 * API キーのあるプロバイダだけ、CLI モードは Claude CLI が起動するときに
 * Anthropic、Codex CLI が ChatGPT でログイン済みのときに OpenAI（routing2b）、
 * 補助AIが無効なら何もない。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
let keys: Record<string, string | null> = {};
mock.module('../../../utils/ai-client/credentials', () => ({
  getApiKeyForProvider: async (p: string) => keys[p] ?? null,
}));
let cliAvailable: boolean | Error = true;
mock.module('../../../utils/ai-client/claude-cli-provider', () => ({
  isClaudeCliAvailable: async () => {
    if (cliAvailable instanceof Error) throw cliAvailable;
    return cliAvailable;
  },
}));

let codexStatus: string | Error = 'missing';
mock.module('../../../utils/ai-client/codex-cli-provider', () => ({
  getCodexCliStatus: async () => {
    if (codexStatus instanceof Error) throw codexStatus;
    return codexStatus;
  },
  isCodexCliAvailable: async () => codexStatus === 'ready',
  callCodexCli: async () => ({ content: '', tokensUsed: 0 }),
  buildCodexAuxArgs: () => [],
  buildCodexAuxEnv: () => ({}),
  CODEX_AUX_DISABLED_FEATURES: [],
  CODEX_AUX_PREAMBLE: '',
  __resetCodexCliStatusForTests: () => {},
}));

const { resolveConfiguredVendors } = await import('./configured-vendors');

beforeEach(() => {
  keys = {};
  cliAvailable = true;
  codexStatus = 'missing';
});

describe('resolveConfiguredVendors', () => {
  test('API モード: キーのあるプロバイダだけを設定済みにする', async () => {
    keys = { claude: 'sk-ant-xxxxxxxxxxxx' };
    const v = await resolveConfiguredVendors('api');
    expect(v.configured).toEqual(['anthropic']);
    expect(v.unconfigured).toEqual([
      { vendor: 'openai', reason: 'API キーが設定されていない' },
      { vendor: 'google', reason: 'API キーが設定されていない' },
    ]);
  });

  test('CLI モード: Claude CLI が起動すれば Anthropic だけ', async () => {
    keys = { chatgpt: 'sk-xxxxxxxxxxxxxxxx' }; // irrelevant: CLI mode never uses API keys
    expect((await resolveConfiguredVendors('cli')).configured).toEqual(['anthropic']);
  });

  test('CLI モード: Claude CLI がない・確認に失敗したら何も設定されていない', async () => {
    cliAvailable = false;
    expect((await resolveConfiguredVendors('cli')).configured).toEqual([]);
    cliAvailable = new Error('spawn ENOENT');
    const v = await resolveConfiguredVendors('cli');
    expect(v.configured).toEqual([]);
    expect(v.unconfigured[0].vendor).toBe('anthropic');
  });

  test('補助AIが無効なら、どのベンダーも使わない', async () => {
    keys = { claude: 'sk-ant-xxxxxxxxxxxx' };
    expect((await resolveConfiguredVendors('off')).configured).toEqual([]);
  });

  test('CLI モード: Codex CLI が ChatGPT でログイン済みなら OpenAI も（Claude が先）', async () => {
    codexStatus = 'ready';
    const v = await resolveConfiguredVendors('cli');
    expect(v.configured).toEqual(['anthropic', 'openai']);
    expect(v.unconfigured).toEqual([
      { vendor: 'google', reason: 'CLI の補助経路が無い（Gemini）' },
    ]);
  });

  test('CLI モード: Codex CLI だけのホストは OpenAI だけ', async () => {
    cliAvailable = false;
    codexStatus = 'ready';
    const v = await resolveConfiguredVendors('cli');
    expect(v.configured).toEqual(['openai']);
    expect(v.unconfigured.map((u) => u.vendor)).toEqual(['anthropic', 'google']);
  });

  test('CLI モード: Codex の未ログイン・API キーのログイン・確認失敗は理由つきで外す', async () => {
    const reasonFor = async () =>
      (await resolveConfiguredVendors('cli')).unconfigured.find((u) => u.vendor === 'openai')
        ?.reason;
    codexStatus = 'not_logged_in';
    expect(await reasonFor()).toBe('Codex CLI に ChatGPT でログインしていない');
    codexStatus = 'not_chatgpt_login';
    expect(await reasonFor()).toContain('API キーでログインしている');
    codexStatus = new Error('spawn ENOENT');
    expect(await reasonFor()).toBe('Codex CLI が見つからない・起動しない');
    expect((await resolveConfiguredVendors('cli')).configured).toEqual(['anthropic']);
  });
});
