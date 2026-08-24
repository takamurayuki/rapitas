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
});
