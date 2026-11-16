/**
 * routing-policy.repair-escalation テスト
 *
 * routing2a E: 検証された能力不足による差し戻しが再試行として下限を premium に
 * 上げること、そして premium 抑制（premiumJustified=false）が暫定停止されて
 * 下限を下げず、その事実が理由文に残ることを固定する。
 */
import { describe, test, expect } from 'bun:test';
import { computeMinTierWithReason } from './routing-policy';

describe('能力不足の差し戻しは再試行として格上げされる', () => {
  test('キューの再試行が0でも、能力不足の差し戻しがあれば premium', () => {
    const r = computeMinTierWithReason({
      role: 'implementer',
      taskRetries: 0,
      capabilityRepairs: 1,
      riskHigh: false,
    });
    expect(r.tier).toBe('premium');
    expect(r.reason).toContain('差し戻し');
  });

  test('能力不足の差し戻しが無ければ従来どおり standard', () => {
    expect(
      computeMinTierWithReason({
        role: 'implementer',
        taskRetries: 0,
        capabilityRepairs: 0,
        riskHigh: false,
      }).tier,
    ).toBe('standard');
  });

  test('高リスクでも、premium にしたのは差し戻しだと理由に残す', () => {
    const r = computeMinTierWithReason({
      role: 'implementer',
      taskRetries: 0,
      capabilityRepairs: 1,
      riskHigh: true,
    });
    expect(r.tier).toBe('premium');
    expect(r.reason).toContain('差し戻し');
  });
});

describe('premium 抑制は暫定停止', () => {
  test('premiumJustified=false でも premium の下限を下げない', () => {
    const r = computeMinTierWithReason({
      role: 'implementer',
      taskRetries: 1,
      riskHigh: false,
      retryCause: 'diff rejected',
      premiumJustified: false,
    });
    expect(r.tier).toBe('premium');
    expect(r.premiumSuppressionSuspended).toBe(true);
    expect(r.reason).toContain('premium抑制は暫定停止中');
  });

  test('差し戻しによる premium も抑制されない', () => {
    const r = computeMinTierWithReason({
      role: 'implementer',
      taskRetries: 0,
      capabilityRepairs: 2,
      riskHigh: false,
      premiumJustified: false,
    });
    expect(r.tier).toBe('premium');
  });

  test('抑制が発動しない場面では停止の注記を付けない', () => {
    const r = computeMinTierWithReason({
      role: 'implementer',
      taskRetries: 1,
      riskHigh: false,
      retryCause: 'diff rejected',
      premiumJustified: true,
    });
    expect(r.premiumSuppressionSuspended).toBeUndefined();
    expect(r.reason).not.toContain('暫定停止');
  });
});
