/**
 * role-route-inputs テスト
 *
 * 自動選択の判定と、ルーティング失敗時のフォールバックを検証する。
 */
import { describe, test, expect, mock } from 'bun:test';
import { shouldAutoSelectModel, routeModelForRole } from './role-route-inputs';

describe('shouldAutoSelectModel', () => {
  test("'auto' / null / 空文字は自動選択", () => {
    expect(shouldAutoSelectModel('auto')).toBe(true);
    expect(shouldAutoSelectModel(null)).toBe(true);
    expect(shouldAutoSelectModel(undefined)).toBe(true);
    expect(shouldAutoSelectModel('')).toBe(true);
    expect(shouldAutoSelectModel('   ')).toBe(true);
  });

  test('回帰: null は「エージェント既定モデル」ではなく自動選択', () => {
    // orchestrator は null を agentConfig.modelId(=premium固定)にフォールバック
    // させており、planner/verifier がルーターを一度も通らなかった。手動実行側
    // (role-resolver) は同じ null を auto と解釈しており、同一フェーズが起動方法
    // 次第で別モデルになっていた。
    expect(shouldAutoSelectModel(null)).toBe(true);
  });

  test('明示的なモデルIDは尊重する', () => {
    expect(shouldAutoSelectModel('claude-opus-4-8')).toBe(false);
    expect(shouldAutoSelectModel('claude-haiku-4-5-20251001')).toBe(false);
  });
});

describe('routeModelForRole', () => {
  test('ルーティングが失敗しても投げず sonnet エイリアスに落ちる', async () => {
    // Fail at the FIRST step after the dynamic imports, so the test never
    // reaches a DB call and stays fast and quiet.
    mock.module('./role-provider-resolver', () => ({
      resolveRoleProviderPreferences: () => {
        throw new Error('routing exploded');
      },
      inferProviderFromModelId: mock(() => null),
    }));
    const r = await routeModelForRole({
      taskId: 1,
      role: 'implementer',
      task: { title: 't', description: null, labels: '[]', themeId: null },
    });
    expect(r.modelId).toBe('sonnet');
    expect(r.details.fallback).toBe(true);
  });

  test('task-budget が spendUnknown を返しても hardCapTier は変化させず伝播するだけ', async () => {
    // A generic Prisma-shaped stub so every dependency reached along the
    // way (role-provider-resolver, workflow-queue, outcome-telemetry,
    // role-evidence) resolves to a benign default instead of hitting a real
    // DB connection. Each of their call sites already tolerates this via
    // .catch(...) or a null-safe read — this test only needs task-budget's
    // own resolution to be a controlled spendUnknown state.
    const stubModel = () => ({
      findMany: () => Promise.resolve([]),
      findFirst: () => Promise.resolve(null),
      findUnique: () => Promise.resolve(null),
      count: () => Promise.resolve(0),
      groupBy: () => Promise.resolve([]),
    });
    mock.module('../../config/database', () => ({
      prisma: new Proxy({}, { get: () => stubModel() }),
      ensureDatabaseConnection: () => Promise.resolve(),
    }));
    // The earlier test in this file replaces this module with a throwing
    // stub; mock.module is file-global, so it must be re-set here or this
    // test would inherit that failure and never reach the budget logic.
    mock.module('./role-provider-resolver', () => ({
      resolveRoleProviderPreferences: () => Promise.resolve({}),
      inferProviderFromModelId: mock(() => null),
    }));
    mock.module('./task-budget', () => ({
      resolveTaskBudgetCap: () =>
        Promise.resolve({
          spentUsd: 0,
          budgetUsd: 25,
          spendUnknown: true,
          unknownReason: '支出取得に失敗（db down）— tier判定を保留',
        }),
    }));
    const getStableSmartRoute = mock(() =>
      Promise.resolve({ recommendedModel: 'claude-sonnet-5', recommendedTier: 'standard' }),
    );
    mock.module('../ai/model-route-stability', () => ({ getStableSmartRoute }));

    const r = await routeModelForRole({
      taskId: 42,
      role: 'implementer',
      task: { title: 't', description: null, labels: '[]', themeId: null },
    });

    expect(r.details.fallback).toBeUndefined();
    expect(getStableSmartRoute).toHaveBeenCalledTimes(1);
    const [, , options] = getStableSmartRoute.mock.calls[0] as [
      unknown,
      unknown,
      Record<string, unknown>,
    ];
    // capTier stays undefined — an unknown spend lookup must not be read as
    // "no ceiling" nor invent a new one; it just defers to the existing floor.
    expect(options.hardCapTier).toBeUndefined();
    expect(r.details.budgetSpendUnknown).toBe(true);
    expect(r.details.budgetUnknownReason).toContain('db down');
  });
});
