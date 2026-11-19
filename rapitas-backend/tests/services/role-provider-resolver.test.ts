/**
 * role-provider-resolver テスト
 *
 * resolveRoleProviderPreferences は手動設定（ロールの優先プロバイダ・全体の既定・
 * 既定エージェント）を読まず、このホストで使えるプロバイダだけから決める。
 * 非レビューロールは upstream に追従し（無ければ経路順の先頭）、検証系は
 * 別に使えるプロバイダがあるときだけ upstream を除外する。使えない
 * プロバイダは常に除外する。inferProviderFromModelId は純粋関数として
 * 境界値（codex- プレフィックス修正の回帰確認を含む）を直接検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { Provider } from '../../services/ai/model-discovery/types';

let roleConfig: { preferredProviderOverride: string | null } | null = null;
let userSettings: { defaultAiProvider: string | null } | null = null;
let recentExecution: { modelName: string | null } | null = null;
let defaultAgent: { agentType: string } | null = null;
// Active agent configs. Default has a second provider so the pre-existing
// cross-provider tests keep exercising the exclusion path.
let activeAgents: Array<{ agentType: string }> = [
  { agentType: 'claude-code' },
  { agentType: 'codex' },
];

mock.module('../../config/database', () => ({
  prisma: {
    workflowRoleConfig: {
      findFirst: () => Promise.resolve(roleConfig),
    },
    userSettings: {
      findFirst: () => Promise.resolve(userSettings),
    },
    agentExecution: {
      findFirst: () => Promise.resolve(recentExecution),
    },
    aIAgentConfig: {
      findFirst: () => Promise.resolve(defaultAgent),
      findMany: () => Promise.resolve(activeAgents),
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { resolveRoleProviderPreferences, inferProviderFromModelId } =
  await import('../../services/workflow/role-provider-resolver');

beforeEach(() => {
  roleConfig = null;
  userSettings = null;
  recentExecution = null;
  defaultAgent = null;
  activeAgents = [{ agentType: 'claude-code' }, { agentType: 'codex' }];
});

describe('inferProviderFromModelId — 純粋関数の境界値', () => {
  test('codex- プレフィックスは openai と判定される（旧正規表現の見落とし回帰）', () => {
    expect(inferProviderFromModelId('codex-auto-review')).toBe('openai');
    expect(inferProviderFromModelId('codex-mini-latest')).toBe('openai');
  });

  test('gpt- / o1 系も openai', () => {
    expect(inferProviderFromModelId('gpt-4o')).toBe('openai');
    expect(inferProviderFromModelId('o1-preview')).toBe('openai');
  });

  test('claude/opus/sonnet/haiku 系は claude', () => {
    expect(inferProviderFromModelId('claude-sonnet-4-6')).toBe('claude');
    expect(inferProviderFromModelId('claude-3-opus')).toBe('claude');
  });

  test('gemini 系は gemini', () => {
    expect(inferProviderFromModelId('gemini-1.5-pro')).toBe('gemini');
  });

  test('ollama/llama/mistral 系は ollama', () => {
    expect(inferProviderFromModelId('ollama/llama3')).toBe('ollama');
    expect(inferProviderFromModelId('mistral-7b')).toBe('ollama');
  });

  test('未知の id は null', () => {
    expect(inferProviderFromModelId('some-unknown-model-xyz')).toBeNull();
  });
});

const bothUsable = {
  usable: ['claude', 'openai'] as Provider[],
  excluded: ['gemini', 'ollama'] as Provider[],
  cooled: [] as Provider[],
  reasons: {},
};
const claudeOnly = {
  usable: ['claude'] as Provider[],
  excluded: ['openai', 'gemini', 'ollama'] as Provider[],
  cooled: [] as Provider[],
  reasons: {},
};
const resolve = (role: string, phase = bothUsable) =>
  resolveRoleProviderPreferences(role, 1, { phaseProviders: async () => phase });

describe('resolveRoleProviderPreferences — 手動設定は読まない', () => {
  test('ロールの優先プロバイダや全体の既定が残っていても無視する', async () => {
    roleConfig = { preferredProviderOverride: 'gemini' };
    userSettings = { defaultAiProvider: 'openai' };
    defaultAgent = { agentType: 'codex' };
    const result = await resolve('implementer');
    expect(result.preferredProvider).toBe('claude');
  });

  test('使えないプロバイダは常に除外される', async () => {
    const result = await resolve('implementer', claudeOnly);
    expect(result.excludeProviders).toEqual(['openai', 'gemini', 'ollama']);
  });
});

describe('resolveRoleProviderPreferences — 非レビューロール', () => {
  test('upstream が無ければ経路順の先頭（Claude）を優先する', async () => {
    const result = await resolve('researcher');
    expect(result.preferredProvider).toBe('claude');
    expect(result.excludeProviders).toEqual(['gemini', 'ollama']);
  });

  test('upstream のプロバイダに追従する（ビルドチェーンの一貫性）', async () => {
    recentExecution = { modelName: 'gpt-6-astra' };
    const result = await resolve('implementer');
    expect(result.preferredProvider).toBe('openai');
  });

  test('upstream が今は使えないプロバイダなら経路順の先頭に戻る', async () => {
    recentExecution = { modelName: 'gpt-6-astra' };
    const result = await resolve('implementer', claudeOnly);
    expect(result.preferredProvider).toBe('claude');
  });
});

describe('resolveRoleProviderPreferences — 検証系ロール', () => {
  test('別に使えるプロバイダがあれば upstream を除外し、それを優先する', async () => {
    recentExecution = { modelName: 'claude-opus-5-5' };
    for (const role of ['verifier', 'auto_verifier']) {
      const result = await resolve(role);
      expect(result.preferredProvider).toBe('openai');
      expect(result.excludeProviders).toEqual(['gemini', 'ollama', 'claude']);
    }
  });

  test('Claude しか使えないホストでは upstream を除外しない（満たせない除外はしない）', async () => {
    recentExecution = { modelName: 'claude-opus-5-5' };
    const result = await resolve('verifier', claudeOnly);
    expect(result.preferredProvider).toBe('claude');
    expect(result.excludeProviders).toEqual(['openai', 'gemini', 'ollama']);
  });

  test('upstream が分からなければ除外せず経路順の先頭', async () => {
    recentExecution = { modelName: 'totally-unrecognized-id' };
    const result = await resolve('verifier');
    expect(result.preferredProvider).toBe('claude');
    expect(result.excludeProviders).toEqual(['gemini', 'ollama']);
  });
});
