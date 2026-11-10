/**
 * configured-vendors テスト
 *
 * 「設定済みで使えるベンダー」を実際の構成から求めることを固定する: API モードは
 * API キーのあるプロバイダだけ、CLI モードは Claude CLI が起動するときだけ
 * Anthropic、補助AIが無効なら何もない。
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

const { resolveConfiguredVendors } = await import('./configured-vendors');

beforeEach(() => {
  keys = {};
  cliAvailable = true;
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
});
