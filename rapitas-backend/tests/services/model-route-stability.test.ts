/**
 * model-route-stability テスト
 *
 * 同一 taskId:role:minTier の再呼び出しがキャッシュされたルーティング結果を再利用し
 * getSmartRoute を再呼び出ししないこと、minTier が異なると別キーとして再ルートされる
 * こと、invalidateStableRoute が指定 taskId:role の全 minTier バリアントだけを消し
 * 他の taskId/role のピンには影響しないこと、_resetStableRouteCache が全消去する
 * ことを検証する。再現性/セキュリティに関わる決定的キャッシュのため厚めに検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { RoutingDecision } from '../../services/ai/smart-model-router';

let getSmartRouteCallCount = 0;
let getSmartRouteCalls: Array<{ taskId: number; options: unknown }> = [];

mock.module('../../services/ai/smart-model-router', () => ({
  getSmartRoute: (taskId: number, options: unknown) => {
    getSmartRouteCallCount += 1;
    getSmartRouteCalls.push({ taskId, options });
    // Return a fresh object each time so identity comparison (`===`) proves
    // whether the caller got a cached hit or a freshly computed decision.
    const decision: RoutingDecision = {
      recommendedModel: `model-call-${getSmartRouteCallCount}`,
      recommendedTier: 'standard',
      reason: 'test',
      alternativeModels: [],
      costEstimate: {
        modelId: `model-call-${getSmartRouteCallCount}`,
        modelTier: 'standard',
        estimatedTokens: 100,
        estimatedCost: 0.01,
        confidence: 0.5,
        basedOnSamples: 0,
      },
    };
    return Promise.resolve(decision);
  },
}));

const { getStableSmartRoute, invalidateStableRoute, _resetStableRouteCache } =
  await import('../../services/ai/model-route-stability');

beforeEach(() => {
  getSmartRouteCallCount = 0;
  getSmartRouteCalls = [];
  _resetStableRouteCache();
});

describe('getStableSmartRoute — キャッシュヒット', () => {
  test('同一 taskId:role:minTier の再呼び出しは getSmartRoute を再実行せず同じ結果を返す', async () => {
    const first = await getStableSmartRoute(1, 'implementer', { minTier: 'standard' });
    const second = await getStableSmartRoute(1, 'implementer', { minTier: 'standard' });
    expect(getSmartRouteCallCount).toBe(1);
    expect(second).toBe(first); // identity — pinned, not recomputed
    expect(second.recommendedModel).toBe(first.recommendedModel);
  });

  test('minTier 未指定でも一貫してキャッシュされる（none キー）', async () => {
    const first = await getStableSmartRoute(2, 'researcher', {});
    const second = await getStableSmartRoute(2, 'researcher', {});
    expect(getSmartRouteCallCount).toBe(1);
    expect(second).toBe(first);
  });
});

describe('getStableSmartRoute — キャッシュミス（別キー）', () => {
  test('role が異なれば別キーとして再ルートされる', async () => {
    await getStableSmartRoute(1, 'implementer', {});
    await getStableSmartRoute(1, 'verifier', {});
    expect(getSmartRouteCallCount).toBe(2);
  });

  test('taskId が異なれば別キーとして再ルートされる', async () => {
    await getStableSmartRoute(1, 'implementer', {});
    await getStableSmartRoute(2, 'implementer', {});
    expect(getSmartRouteCallCount).toBe(2);
  });

  test('minTier が異なれば別キー — 意図的な昇格（retry/escalation）は再ルートされる', async () => {
    const standard = await getStableSmartRoute(1, 'implementer', { minTier: 'standard' });
    const premium = await getStableSmartRoute(1, 'implementer', { minTier: 'premium' });
    expect(getSmartRouteCallCount).toBe(2);
    expect(premium).not.toBe(standard);
    expect(premium.recommendedModel).not.toBe(standard.recommendedModel);
  });
});

describe('getStableSmartRoute — capTier もキーに含まれる', () => {
  test('capTier が異なれば別キー — 実績変化による引き下げは再ルートされる', async () => {
    await getStableSmartRoute(7, 'implementer', { minTier: 'standard' });
    await getStableSmartRoute(7, 'implementer', { minTier: 'standard', capTier: 'economy' });
    expect(getSmartRouteCallCount).toBe(2);
  });

  test('同一 capTier の再呼び出しはキャッシュヒットする', async () => {
    const first = await getStableSmartRoute(7, 'implementer', { capTier: 'economy' });
    const second = await getStableSmartRoute(7, 'implementer', { capTier: 'economy' });
    expect(getSmartRouteCallCount).toBe(1);
    expect(second).toBe(first);
  });
});

describe('invalidateStableRoute — 指定 taskId:role の全 minTier バリアントのみ消去', () => {
  test('無効化後の再呼び出しは再ルートされる', async () => {
    await getStableSmartRoute(1, 'implementer', {});
    invalidateStableRoute(1, 'implementer');
    await getStableSmartRoute(1, 'implementer', {});
    expect(getSmartRouteCallCount).toBe(2);
  });

  test('同一 taskId:role の複数 minTier バリアントを一括で消す', async () => {
    await getStableSmartRoute(1, 'implementer', { minTier: 'standard' });
    await getStableSmartRoute(1, 'implementer', { minTier: 'premium' });
    expect(getSmartRouteCallCount).toBe(2);

    invalidateStableRoute(1, 'implementer');

    // Both variants must recompute after invalidation — neither pin survives.
    await getStableSmartRoute(1, 'implementer', { minTier: 'standard' });
    await getStableSmartRoute(1, 'implementer', { minTier: 'premium' });
    expect(getSmartRouteCallCount).toBe(4);
  });

  test('他の taskId/role のピンには影響しない', async () => {
    const other = await getStableSmartRoute(2, 'verifier', {});
    await getStableSmartRoute(1, 'implementer', {});

    invalidateStableRoute(1, 'implementer');

    const otherAgain = await getStableSmartRoute(2, 'verifier', {});
    expect(otherAgain).toBe(other); // untouched — still cached
    expect(getSmartRouteCallCount).toBe(2); // only the two initial computations
  });

  test('存在しない taskId:role を無効化してもエラーにならない（no-op）', () => {
    expect(() => invalidateStableRoute(999, 'nonexistent-role')).not.toThrow();
  });
});

describe('_resetStableRouteCache — 全消去', () => {
  test('リセット後は全キーが再ルートされる', async () => {
    await getStableSmartRoute(1, 'implementer', {});
    await getStableSmartRoute(2, 'verifier', {});
    expect(getSmartRouteCallCount).toBe(2);

    _resetStableRouteCache();

    await getStableSmartRoute(1, 'implementer', {});
    await getStableSmartRoute(2, 'verifier', {});
    expect(getSmartRouteCallCount).toBe(4);
  });
});
