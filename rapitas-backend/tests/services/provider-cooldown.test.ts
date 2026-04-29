/**
 * Provider Cooldown テスト
 *
 * Verifies cooldown registration, expiry, and listActive behavior.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import {
  __resetCooldowns,
  clearCooldown,
  isProviderInCooldown,
  listActiveCooldowns,
  markProviderCooldown,
} from '../../services/ai/provider-cooldown';

beforeEach(() => {
  __resetCooldowns();
});

describe('markProviderCooldown', () => {
  it('quotaを記録すると isProviderInCooldown が true を返す', () => {
    markProviderCooldown('openai', 'quota');
    expect(isProviderInCooldown('openai')).toBe(true);
  });

  it('明示的な resetAt を尊重する', () => {
    const future = new Date(Date.now() + 5_000);
    markProviderCooldown('claude', 'quota', future);
    const list = listActiveCooldowns();
    expect(list.length).toBe(1);
    expect(list[0].until).toBe(future.getTime());
  });

  it('既存より短い resetAt では上書きしない', () => {
    const longer = new Date(Date.now() + 10_000);
    const shorter = new Date(Date.now() + 1_000);
    markProviderCooldown('openai', 'quota', longer);
    markProviderCooldown('openai', 'rate_limit', shorter);
    const entry = listActiveCooldowns()[0];
    expect(entry.until).toBe(longer.getTime());
  });

  it('過ぎた cooldown は listActiveCooldowns から除外される', () => {
    markProviderCooldown('gemini', 'quota', new Date(Date.now() - 10_000));
    const list = listActiveCooldowns();
    expect(list.length).toBe(0);
    expect(isProviderInCooldown('gemini')).toBe(false);
  });

  it('clearCooldown は即時削除する', () => {
    markProviderCooldown('claude', 'rate_limit');
    clearCooldown('claude');
    expect(isProviderInCooldown('claude')).toBe(false);
  });
});
