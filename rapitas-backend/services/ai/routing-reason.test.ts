/**
 * routing-reason テスト
 *
 * ティア決定の説明文が「実際に決めた要因」を指すことを検証する。
 */
import { describe, test, expect } from 'bun:test';
import { buildRouteReason } from './routing-reason';

describe('buildRouteReason', () => {
  test('回帰: 下限で premium になった場合に複雑度のせいにしない', () => {
    // 旧実装は複雑度分岐へフォールスルーし
    // 「複雑度5（低）のためpremiumモデルで十分」という矛盾した監査行を出していた。
    const reason = buildRouteReason({
      tier: 'premium',
      complexity: 5,
      driver: 'floor',
      floorReason: '高リスク領域(スキーマ/認証/決済/セキュリティ)',
    });
    expect(reason).toContain('高リスク');
    expect(reason).not.toContain('で十分');
  });

  test('複雑度が決めた場合は従来どおりの文面', () => {
    expect(buildRouteReason({ tier: 'economy', complexity: 20, driver: 'complexity' })).toContain(
      '（低）',
    );
    expect(buildRouteReason({ tier: 'standard', complexity: 50, driver: 'complexity' })).toContain(
      '（中）',
    );
    expect(buildRouteReason({ tier: 'premium', complexity: 90, driver: 'complexity' })).toContain(
      '（高）',
    );
  });

  test('実績・予算の要因もそれぞれ区別される', () => {
    expect(buildRouteReason({ tier: 'economy', complexity: 50, driver: 'evidence' })).toContain(
      '実績',
    );
    expect(buildRouteReason({ tier: 'economy', complexity: 50, driver: 'budget' })).toContain(
      '予算',
    );
  });
});
