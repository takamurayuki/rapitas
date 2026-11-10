/**
 * SmartModelRouter × ティア表 テスト
 *
 * SmartRouter のティアと単価がティア表から解決されること、レビュー系ロールに
 * 未登録・economy のモデルを選ばないこと、下限ティアを満たせないときに黙って
 * 下げず、判定結果と判断記録に未充足を残すことを固定する。
 * model-discovery は実物を使い、その下の各プロバイダのプローブだけをモックする
 * （プローブは実物と同じく classifyTier / inferCostPer1k で行を作る）。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { DiscoveredModel, Provider } from './model-discovery/types';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findUnique: () => Promise.resolve({ complexityScore: 20, title: 'T', priority: 'medium' }),
    },
    agentExecution: { findMany: () => Promise.resolve([]) },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const decisions: Array<Record<string, unknown>> = [];
mock.module('../observability/decision-trace', () => ({
  recordDecision: (input: Record<string, unknown>) => {
    decisions.push(input);
    return Promise.resolve();
  },
}));

const { classifyTier, inferCostPer1k } = await import('./model-discovery/tier-classifier');

/** Models each probe reports, built the way the real probes build them. */
const reported: Record<Provider, string[]> = { claude: [], openai: [], gemini: [], ollama: [] };
const costOverride = new Map<string, number>();

function probeFor(provider: Provider) {
  return () => {
    const models: DiscoveredModel[] = reported[provider].map((id) => {
      const tier = classifyTier(id);
      return {
        id,
        provider,
        tier,
        costPer1kTokens: costOverride.get(id) ?? inferCostPer1k(id, tier),
        source: 'cli-alias',
      };
    });
    return Promise.resolve({ provider, available: models.length > 0, models });
  };
}

mock.module('./model-discovery/probes/claude-probe', () => ({ probeClaude: probeFor('claude') }));
mock.module('./model-discovery/probes/openai-probe', () => ({ probeOpenAi: probeFor('openai') }));
mock.module('./model-discovery/probes/gemini-probe', () => ({ probeGemini: probeFor('gemini') }));
mock.module('./model-discovery/probes/ollama-probe', () => ({ probeOllama: probeFor('ollama') }));

const { getSmartRoute } = await import('./smart-model-router');
const { invalidateModelDiscoveryCache } = await import('./model-discovery');
const { __resetCooldowns } = await import('./provider-cooldown');

beforeEach(() => {
  reported.claude = [];
  reported.openai = [];
  reported.gemini = [];
  reported.ollama = [];
  costOverride.clear();
  decisions.length = 0;
  invalidateModelDiscoveryCache();
  __resetCooldowns();
});

describe('SmartRouter はティア表から解決する', () => {
  test('premium の下限では表の premium を選び、名前が旗艦風の未登録モデルは選ばない', async () => {
    reported.claude = ['opus', 'sonnet', 'haiku', 'claude-opus-4-8'];
    const route = await getSmartRoute(1, {
      role: 'implementer',
      minTier: 'premium',
      includeAlternatives: false,
    });
    expect(route.recommendedModel).toBe('opus');
    expect(route.recommendedTier).toBe('premium');
    // The estimate uses the table's official price ($4 / $20 per MTok).
    expect(route.costEstimate.modelTier).toBe('premium');
  });

  test('Codex（OpenAI）だけの構成でも表のティアで選ぶ', async () => {
    reported.openai = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'];
    const route = await getSmartRoute(1, {
      role: 'implementer',
      minTier: 'standard',
      includeAlternatives: false,
    });
    expect(route.recommendedModel).toBe('gpt-6.1-sol');
    expect(route.recommendedTier).toBe('standard');
  });

  test('レビュー系ロール（verifier）には、安くても未登録のモデルを選ばない', async () => {
    reported.claude = ['sonnet', 'claude-sonnet-4-20250514'];
    costOverride.set('claude-sonnet-4-20250514', 0.0001);
    const forImplementer = await getSmartRoute(1, {
      role: 'implementer',
      minTier: 'standard',
      includeAlternatives: false,
    });
    expect(forImplementer.recommendedModel).toBe('claude-sonnet-4-20250514');
    invalidateModelDiscoveryCache();
    const forVerifier = await getSmartRoute(1, {
      role: 'verifier',
      minTier: 'standard',
      includeAlternatives: false,
    });
    expect(forVerifier.recommendedModel).toBe('sonnet');
  });
});

describe('下限を満たせない場合', () => {
  test('黙って下げず、判定結果と判断記録に未充足を残す', async () => {
    reported.claude = ['sonnet', 'haiku'];
    const route = await getSmartRoute(1, {
      role: 'implementer',
      minTier: 'premium',
      minTierReason: 'このタスクの再試行',
      includeAlternatives: false,
    });
    expect(route.constraintShortfall).toEqual({
      requiredTier: 'premium',
      selectedTier: 'standard',
      reason: expect.stringContaining('premium'),
    });
    expect(route.reason).toContain('要件未達');
    const recorded = decisions.find((d) => d.summary === 'モデル選択の要件未達');
    expect(recorded).toBeDefined();
    expect((recorded!.input as Record<string, unknown>).requiredTier).toBe('premium');
  });

  test('下限を満たせていれば未充足は付かない', async () => {
    reported.claude = ['opus', 'sonnet'];
    const route = await getSmartRoute(1, {
      role: 'implementer',
      minTier: 'premium',
      includeAlternatives: false,
    });
    expect(route.constraintShortfall).toBeUndefined();
    expect(decisions.some((d) => d.summary === 'モデル選択の要件未達')).toBe(false);
  });
});
