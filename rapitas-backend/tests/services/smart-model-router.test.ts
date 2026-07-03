/**
 * SmartModelRouter テスト
 *
 * getSmartRoute の複雑度/予算による tier 選定分岐、minTier フロア（引き上げのみ）、
 * cooldown 中プロバイダーの自動除外（フォールバック）、selectBestModel が空だった
 * 場合の最終フォールバック、getBudgetStatus の推奨メッセージ閾値を検証する。
 * model-discovery は境界としてモック（selectBestModel/discoverModels の中身は
 * services/ai/model-discovery 側の責務）。provider-cooldown は実物を使い、
 * cooldown → excludeProviders マージという実際の統合を検証する。
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type {
  SelectionContext,
  DiscoveredModel,
  ModelTier,
} from '../../services/ai/model-discovery/types';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

// ---- prisma mock ----
let taskRow: { complexityScore: number | null; title: string; priority: string } | null = {
  complexityScore: 50,
  title: 'T',
  priority: 'medium',
};
let agentExecutions: Array<{ tokensUsed: number; agentConfig?: { modelId: string } | null }> = [];

mock.module('../../config/database', () => ({
  prisma: {
    task: { findUnique: () => Promise.resolve(taskRow) },
    agentExecution: {
      findMany: () => Promise.resolve(agentExecutions),
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

// ---- model-discovery mock (module boundary) ----
let discoveryModels: DiscoveredModel[] = [];
let selectBestModelResult: { model: DiscoveredModel; tier: ModelTier } | null = null;
let selectBestModelCalls: SelectionContext[] = [];
let selectBestModelImpl:
  | ((ctx: SelectionContext) => { model: DiscoveredModel; tier: ModelTier } | null)
  | null = null;

mock.module('../../services/ai/model-discovery', () => ({
  discoverModels: () =>
    Promise.resolve({
      fetchedAt: new Date().toISOString(),
      providers: [{ provider: 'claude', available: true, models: discoveryModels }],
      models: discoveryModels,
    }),
  selectBestModel: (ctx: SelectionContext) => {
    selectBestModelCalls.push(ctx);
    const picked = selectBestModelImpl ? selectBestModelImpl(ctx) : selectBestModelResult;
    return Promise.resolve(picked);
  },
}));

const { getSmartRoute, getBudgetStatus } = await import('../../services/ai/smart-model-router');
const { markProviderCooldown, __resetCooldowns } =
  await import('../../services/ai/provider-cooldown');

function model(
  id: string,
  tier: ModelTier,
  provider: DiscoveredModel['provider'] = 'claude',
): DiscoveredModel {
  return { id, tier, provider, costPer1kTokens: 0.006, source: 'cli-alias' };
}

beforeEach(() => {
  taskRow = { complexityScore: 50, title: 'T', priority: 'medium' };
  agentExecutions = [];
  discoveryModels = [model('m-standard', 'standard')];
  selectBestModelResult = { model: model('m-standard', 'standard'), tier: 'standard' };
  selectBestModelImpl = null;
  selectBestModelCalls = [];
  __resetCooldowns();
});

afterEach(() => {
  __resetCooldowns();
});

describe('getSmartRoute — 複雑度による tier 選定', () => {
  test('複雑度<=35（非緊急・予算圧迫なし）→ economy', async () => {
    taskRow = { complexityScore: 20, title: 'T', priority: 'medium' };
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    const route = await getSmartRoute(1);
    expect(route.recommendedTier).toBe('economy');
  });

  test('複雑度36-70 → standard', async () => {
    taskRow = { complexityScore: 55, title: 'T', priority: 'medium' };
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    const route = await getSmartRoute(1);
    expect(route.recommendedTier).toBe('standard');
  });

  test('複雑度>70 + urgent → premium', async () => {
    taskRow = { complexityScore: 85, title: 'T', priority: 'urgent' };
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    const route = await getSmartRoute(1);
    expect(route.recommendedTier).toBe('premium');
  });

  test('複雑度>70 + 非緊急 → standard（premiumへ昇格しない）', async () => {
    taskRow = { complexityScore: 85, title: 'T', priority: 'medium' };
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    const route = await getSmartRoute(1);
    expect(route.recommendedTier).toBe('standard');
  });

  test('taskが見つからない場合は複雑度50として扱う（デフォルト分岐）', async () => {
    taskRow = null;
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    const route = await getSmartRoute(1);
    expect(route.recommendedTier).toBe('standard'); // 50 は 36-70 レンジ
  });
});

describe('getSmartRoute — 予算圧迫（budgetPressure）分岐', () => {
  // budgetPressure = remaining !== null && remaining < spent * 0.2
  // spent はモデル単価 * トークン数から算出されるため、agentExecutions を空にして
  // spent=0 のまま weeklyBudget を極小に設定し、remaining(=budget - 0) < spent*0.2(=0)
  // は成立しない。予算圧迫を起こすには spent > 0 が必要 — 単価既知のモデルを使わせる。
  test('予算圧迫 + 複雑度>70 + urgent → standard（premiumへは行かない）', async () => {
    taskRow = { complexityScore: 90, title: 'T', priority: 'urgent' };
    // 大量トークン消費実績を積んで spent を weeklyBudget近くまで押し上げる
    agentExecutions = [{ tokensUsed: 500_000, agentConfig: { modelId: 'm-standard' } }];
    discoveryModels = [model('m-standard', 'standard')];
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    const route = await getSmartRoute(1, { weeklyBudget: 1 });
    expect(route.recommendedTier).toBe('standard');
    expect(route.reason).toContain('予算残高が少ない');
  });

  test('予算圧迫 + 複雑度>70 + 非緊急 → economy', async () => {
    taskRow = { complexityScore: 90, title: 'T', priority: 'medium' };
    agentExecutions = [{ tokensUsed: 500_000, agentConfig: { modelId: 'm-standard' } }];
    discoveryModels = [model('m-standard', 'standard')];
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    const route = await getSmartRoute(1, { weeklyBudget: 1 });
    expect(route.recommendedTier).toBe('economy');
  });
});

describe('getSmartRoute — minTier フロア（引き上げのみ・引き下げない）', () => {
  test('計算上 economy でも minTier=premium なら premium まで引き上げる', async () => {
    taskRow = { complexityScore: 10, title: 'T', priority: 'medium' };
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    const route = await getSmartRoute(1, { minTier: 'premium' });
    expect(route.recommendedTier).toBe('premium');
    expect(selectBestModelCalls[0]?.desiredTier).toBe('premium');
  });

  test('計算上 premium のとき minTier=economy を指定しても引き下げない', async () => {
    taskRow = { complexityScore: 90, title: 'T', priority: 'urgent' };
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    const route = await getSmartRoute(1, { minTier: 'economy' });
    expect(route.recommendedTier).toBe('premium');
  });
});

describe('getSmartRoute — cooldown プロバイダーの自動除外（フォールバック）', () => {
  test('cooldown 中の provider が excludeProviders にマージされる', async () => {
    markProviderCooldown('openai', 'quota');
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    await getSmartRoute(1, {});
    expect(selectBestModelCalls[0]?.excludeProviders).toContain('openai');
  });

  test('呼び出し側の excludeProviders と cooldown 分が重複なく統合される', async () => {
    markProviderCooldown('openai', 'quota');
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    await getSmartRoute(1, { excludeProviders: ['openai', 'gemini'] });
    const excluded = selectBestModelCalls[0]?.excludeProviders ?? [];
    expect(new Set(excluded)).toEqual(new Set(['openai', 'gemini']));
  });
});

describe('getSmartRoute — selectBestModel が null のときの最終フォールバック', () => {
  test('discovery にもモデルが無ければ既定の sonnet id にフォールバックする', async () => {
    discoveryModels = [];
    selectBestModelResult = null;
    selectBestModelImpl = null;
    const route = await getSmartRoute(1, {});
    expect(route.recommendedModel).toBe('claude-sonnet-4-6');
  });

  test('selectBestModel が null でも discovery.models[0] があればそれを使う', async () => {
    discoveryModels = [model('fallback-model', 'standard')];
    selectBestModelResult = null;
    selectBestModelImpl = null;
    const route = await getSmartRoute(1, {});
    expect(route.recommendedModel).toBe('fallback-model');
  });
});

describe('getSmartRoute — includeAlternatives:false でDB問い合わせを省略', () => {
  test('alternativeModels が空配列で返る', async () => {
    discoveryModels = [model('m1', 'standard'), model('m2', 'economy')];
    selectBestModelImpl = (ctx) => ({ model: model('m1', ctx.desiredTier), tier: ctx.desiredTier });
    const route = await getSmartRoute(1, { includeAlternatives: false });
    expect(route.alternativeModels).toEqual([]);
  });
});

describe('getSmartRoute — 旧呼び出し形式との後方互換', () => {
  test('第二引数が number のとき weeklyBudget として扱われる', async () => {
    selectBestModelImpl = (ctx) => ({ model: model('m', ctx.desiredTier), tier: ctx.desiredTier });
    const route = await getSmartRoute(1, 100);
    expect(route.recommendedTier).toBeTruthy();
  });
});

describe('getBudgetStatus — 推奨メッセージの閾値', () => {
  test('spent が weeklyBudget の80%超過 → 警告メッセージ', async () => {
    agentExecutions = [{ tokensUsed: 1_000_000, agentConfig: { modelId: 'm' } }];
    discoveryModels = [];
    // discoverModels 内で rateById が空 → inferCostPer1k('m','standard') = 0.006 を使う
    const status = await getBudgetStatus(5); // spent = 1000 * 0.006 = 6.0 > 5*0.8=4
    expect(status.recommendation).toContain('⚠️');
  });

  test('spent が weeklyBudget の50〜80% → 中間メッセージ', async () => {
    agentExecutions = [{ tokensUsed: 500_000, agentConfig: { modelId: 'm' } }];
    discoveryModels = [];
    // spent = 500 * 0.006 = 3.0; budget=5 → 50%=2.5 < 3.0 <= 80%=4.0
    const status = await getBudgetStatus(5);
    expect(status.recommendation).toContain('💡');
  });

  test('spent が weeklyBudget の50%未満 → 順調メッセージ', async () => {
    agentExecutions = [];
    discoveryModels = [];
    const status = await getBudgetStatus(5);
    expect(status.spent).toBe(0);
    expect(status.recommendation).toContain('✅');
  });

  test('weeklyBudget未指定（null）→ remaining は null', async () => {
    agentExecutions = [];
    discoveryModels = [];
    const status = await getBudgetStatus(null);
    expect(status.remaining).toBeNull();
    expect(status.budgetLimit).toBeNull();
  });
});
