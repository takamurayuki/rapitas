/**
 * role-provider-resolver テスト
 *
 * resolveRoleProviderPreferences の解決優先順位（role override > global default >
 * default agent > undefined）、cross-provider センチネル、verifier 系の
 * 自動 upstream 除外、非レビューロールの upstream provider 追従を検証する。
 * inferProviderFromModelId は純粋関数として境界値（codex- プレフィックス修正の
 * 回帰確認を含む）を直接検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

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
      findUnique: () => Promise.resolve(roleConfig),
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

describe('resolveRoleProviderPreferences — 解決優先順位', () => {
  test('明示的な role override が最優先される（verifier でも exclude は付かない）', async () => {
    roleConfig = { preferredProviderOverride: 'gemini' };
    userSettings = { defaultAiProvider: 'openai' };
    const result = await resolveRoleProviderPreferences('verifier', 1);
    expect(result.preferredProvider).toBe('gemini');
    expect(result.excludeProviders).toBeUndefined();
  });

  test('role override が無ければ global default を使う', async () => {
    roleConfig = { preferredProviderOverride: null };
    userSettings = { defaultAiProvider: 'openai' };
    const result = await resolveRoleProviderPreferences('implementer', 1);
    expect(result.preferredProvider).toBe('openai');
  });

  test('role override も global default も無ければ既定 AIAgentConfig の provider を使う', async () => {
    roleConfig = null;
    userSettings = null;
    defaultAgent = { agentType: 'codex' };
    const result = await resolveRoleProviderPreferences('implementer', 1);
    expect(result.preferredProvider).toBe('openai'); // codex → openai family
  });

  test('何も設定が無ければ preferredProvider は undefined（非レビューは upstream にも無ければ undefined のまま）', async () => {
    roleConfig = null;
    userSettings = null;
    defaultAgent = null;
    recentExecution = null;
    const result = await resolveRoleProviderPreferences('implementer', 1);
    expect(result.preferredProvider).toBeUndefined();
  });
});

describe('resolveRoleProviderPreferences — cross-provider センチネル', () => {
  test('override="cross-provider" のとき preferredProvider は付けず upstream を除外する', async () => {
    roleConfig = { preferredProviderOverride: 'cross-provider' };
    recentExecution = { modelName: 'claude-sonnet-4-6' };
    const result = await resolveRoleProviderPreferences('implementer', 1);
    expect(result.preferredProvider).toBeUndefined();
    expect(result.excludeProviders).toEqual(['claude']);
  });

  test('cross-provider でも upstream 実行が無ければ excludeProviders は付かない', async () => {
    roleConfig = { preferredProviderOverride: 'cross-provider' };
    recentExecution = null;
    const result = await resolveRoleProviderPreferences('implementer', 1);
    expect(result.excludeProviders).toBeUndefined();
  });
});

describe('resolveRoleProviderPreferences — レビュー系ロールの自動 upstream 除外', () => {
  test('verifier + override無し → upstream provider を自動除外する', async () => {
    roleConfig = { preferredProviderOverride: null };
    recentExecution = { modelName: 'gpt-4o' };
    const result = await resolveRoleProviderPreferences('verifier', 1);
    expect(result.excludeProviders).toEqual(['openai']);
  });

  test('auto_verifier も同様に自動除外される', async () => {
    recentExecution = { modelName: 'gemini-1.5-pro' };
    const verifier = await resolveRoleProviderPreferences('verifier', 1);
    expect(verifier.excludeProviders).toEqual(['gemini']);
    const autoVerifier = await resolveRoleProviderPreferences('auto_verifier', 1);
    expect(autoVerifier.excludeProviders).toEqual(['gemini']);
  });

  test('researcher/planner/implementer はレビュー系ではないので自動除外されない', async () => {
    recentExecution = { modelName: 'gpt-4o' };
    const researcher = await resolveRoleProviderPreferences('researcher', 1);
    expect(researcher.excludeProviders).toBeUndefined();
  });
});

describe('resolveRoleProviderPreferences — 非レビューロールの upstream 追従', () => {
  test('明示指定が無い非レビューロールは upstream の provider に追従する（ビルドチェーンの一貫性）', async () => {
    roleConfig = null;
    userSettings = null;
    defaultAgent = null;
    recentExecution = { modelName: 'claude-sonnet-4-6' };
    const result = await resolveRoleProviderPreferences('implementer', 1);
    expect(result.preferredProvider).toBe('claude');
  });

  test('明示指定があれば upstream 追従より優先される', async () => {
    userSettings = { defaultAiProvider: 'openai' };
    recentExecution = { modelName: 'claude-sonnet-4-6' };
    const result = await resolveRoleProviderPreferences('implementer', 1);
    expect(result.preferredProvider).toBe('openai'); // not 'claude' from upstream
  });

  test('upstream の modelName が未知の命名規則なら provider 推定できず undefined のまま', async () => {
    roleConfig = null;
    userSettings = null;
    defaultAgent = null;
    recentExecution = { modelName: 'totally-unrecognized-id' };
    const result = await resolveRoleProviderPreferences('implementer', 1);
    expect(result.preferredProvider).toBeUndefined();
  });
});

describe('cross-provider 除外は実行可能な別プロバイダがある時だけ', () => {
  test('別プロバイダのエージェントが有効なら upstream を除外する', async () => {
    recentExecution = { modelName: 'claude-fable-5' };
    const prefs = await resolveRoleProviderPreferences('verifier', 1);
    expect(prefs.excludeProviders).toEqual(['claude']);
  });

  test('回帰: claude-code しか無い環境では除外しない', async () => {
    // 除外すると SmartRouter が実行できない OpenAI モデルを返し、
    // resolveExecutableAgentConfig がオーバーライドを捨ててエージェント既定
    // モデルで走る。せっかく計算したティア下限と実績キャップが失われるため、
    // 満たせない除外は「除外しない」より悪い。
    activeAgents = [{ agentType: 'claude-code' }];
    recentExecution = { modelName: 'claude-fable-5' };
    const prefs = await resolveRoleProviderPreferences('verifier', 1);
    expect(prefs.excludeProviders).toBeUndefined();
  });

  test('有効なエージェントが1件も無くても落ちない', async () => {
    activeAgents = [];
    recentExecution = { modelName: 'claude-fable-5' };
    const prefs = await resolveRoleProviderPreferences('verifier', 1);
    expect(prefs.excludeProviders).toBeUndefined();
  });
});
