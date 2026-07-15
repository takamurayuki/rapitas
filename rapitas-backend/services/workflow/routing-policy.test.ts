/**
 * routing-policy テスト
 *
 * ロール下限・リスクオーバーライド・失敗エスカレーションのティア決定を検証する。
 */
import { describe, test, expect } from 'bun:test';
import { highestTier, isCapabilityRole, detectHighRisk, computeMinTier } from './routing-policy';

describe('highestTier', () => {
  test('最も能力の高いティアを返す', () => {
    expect(highestTier('economy', 'premium', 'standard')).toBe('premium');
    expect(highestTier('free', 'economy')).toBe('economy');
  });
  test('undefined は無視し、全て未指定なら undefined', () => {
    expect(highestTier(undefined, 'standard', undefined)).toBe('standard');
    expect(highestTier(undefined, undefined)).toBeUndefined();
  });
});

describe('isCapabilityRole', () => {
  test('実装/計画/レビュー/検証は capability ロール', () => {
    // NOTE: planner added — a defective plan is the most expensive failure
    // mode (all implementation follows it), so it gets the standard floor too.
    for (const r of ['implementer', 'planner', 'reviewer', 'verifier', 'auto_verifier']) {
      expect(isCapabilityRole(r)).toBe(true);
    }
  });
  test('調査は capability ロールではない', () => {
    expect(isCapabilityRole('researcher')).toBe(false);
  });
});

describe('detectHighRisk', () => {
  test('スキーマ/認証/決済/セキュリティ語を含むと高リスク', () => {
    expect(detectHighRisk({ text: 'prisma schema を変更' }).high).toBe(true);
    expect(detectHighRisk({ text: '認証フローの修正' }).high).toBe(true);
    expect(detectHighRisk({ text: 'add payment webhook' }).high).toBe(true);
  });
  test('plan の危険なファイルパスでも高リスク', () => {
    expect(
      detectHighRisk({ text: 'tweak', planContent: '- `prisma/schema/core.prisma`' }).high,
    ).toBe(true);
  });
  test('無害なテキストは低リスク', () => {
    expect(
      detectHighRisk({ text: 'ボタンの色を変更', planContent: '- `src/Button.tsx`' }).high,
    ).toBe(false);
  });
});

describe('computeMinTier', () => {
  test('capability ロールは既定で standard 下限', () => {
    expect(computeMinTier({ role: 'implementer', taskRetries: 0, riskHigh: false })).toBe(
      'standard',
    );
  });
  test('調査は下限なし', () => {
    expect(computeMinTier({ role: 'researcher', taskRetries: 0, riskHigh: false })).toBeUndefined();
  });
  test('タスク自身のリトライ(>=1)は premium に引き上げ（ハードシグナル）', () => {
    expect(computeMinTier({ role: 'researcher', taskRetries: 1, riskHigh: false })).toBe('premium');
    expect(computeMinTier({ role: 'implementer', taskRetries: 2, riskHigh: false })).toBe(
      'premium',
    );
  });
  test('テーマエスカレーションはソフト: レベル1は standard、レベル2で premium', () => {
    // Level 1 (>=25% troubled — routine self-repair churn) must NOT force
    // premium: that put every phase of every task on the top model (122/122
    // observed). It only raises floorless roles to standard.
    expect(
      computeMinTier({ role: 'researcher', taskRetries: 0, themeEscalation: 1, riskHigh: false }),
    ).toBe('standard');
    expect(
      computeMinTier({ role: 'implementer', taskRetries: 0, themeEscalation: 1, riskHigh: false }),
    ).toBe('standard');
    expect(
      computeMinTier({ role: 'researcher', taskRetries: 0, themeEscalation: 2, riskHigh: false }),
    ).toBe('premium');
  });
  test('高リスクは premium に引き上げ', () => {
    expect(computeMinTier({ role: 'planner', taskRetries: 0, riskHigh: true })).toBe('premium');
  });
  test('実証済みティアは capability ロールの床を緩和する', () => {
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 0,
        riskHigh: false,
        provenTier: 'economy',
      }),
    ).toBe('economy');
  });
  test('実証済みティアが床より強い場合は緩和しない（床は下がるだけ）', () => {
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 0,
        riskHigh: false,
        provenTier: 'premium',
      }),
    ).toBe('standard');
  });
  test('高リスク/タスクリトライ時は実証済みでも premium を維持', () => {
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 0,
        riskHigh: true,
        provenTier: 'economy',
      }),
    ).toBe('premium');
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 1,
        riskHigh: false,
        provenTier: 'economy',
      }),
    ).toBe('premium');
  });
  test('テーマレベル1では実証済みティアが standard 床まで下げられる（実績収集が凍結しない）', () => {
    expect(
      computeMinTier({
        role: 'implementer',
        taskRetries: 0,
        themeEscalation: 1,
        riskHigh: false,
        provenTier: 'economy',
      }),
    ).toBe('standard');
  });
  test('非 capability ロールは provenTier があっても床なしのまま', () => {
    expect(
      computeMinTier({
        role: 'researcher',
        taskRetries: 0,
        riskHigh: false,
        provenTier: 'economy',
      }),
    ).toBeUndefined();
  });
});
