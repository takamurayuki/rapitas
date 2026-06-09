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
  test('実装/レビュー/検証は capability ロール', () => {
    for (const r of ['implementer', 'reviewer', 'verifier', 'auto_verifier']) {
      expect(isCapabilityRole(r)).toBe(true);
    }
  });
  test('調査/計画は capability ロールではない', () => {
    expect(isCapabilityRole('researcher')).toBe(false);
    expect(isCapabilityRole('planner')).toBe(false);
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
    expect(computeMinTier({ role: 'implementer', escalation: 0, riskHigh: false })).toBe(
      'standard',
    );
  });
  test('調査/計画は下限なし', () => {
    expect(computeMinTier({ role: 'researcher', escalation: 0, riskHigh: false })).toBeUndefined();
  });
  test('失敗エスカレーション(>=1)は premium に引き上げ', () => {
    expect(computeMinTier({ role: 'researcher', escalation: 1, riskHigh: false })).toBe('premium');
    expect(computeMinTier({ role: 'implementer', escalation: 2, riskHigh: false })).toBe('premium');
  });
  test('高リスクは premium に引き上げ', () => {
    expect(computeMinTier({ role: 'planner', escalation: 0, riskHigh: true })).toBe('premium');
  });
});
