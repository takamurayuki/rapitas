/**
 * stats-ops テスト
 *
 * computeMemoryStrength の漸近飽和スコアを検証: 旧線形式のように少量の
 * パターン数で100に張り付かないこと、成長で単調増加すること、成功率低下で
 * スコアが下がること。Own file — mock.module is process-global.
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../config/database', () => ({ prisma: {} }));

const { computeMemoryStrength } = await import('./stats-ops');

describe('computeMemoryStrength', () => {
  test('the live dataset that pinned the old formula at 100 now lands mid-scale', () => {
    // 3 nodes / 322 patterns / 117 episodes / 94% success — old formula: 100.
    const result = computeMemoryStrength({ nodes: 3, patterns: 322, episodes: 117 }, 0.944);
    expect(result.score).toBeGreaterThan(30);
    expect(result.score).toBeLessThan(75); // no longer instantly "expert"
  });

  test('score grows monotonically with memory size', () => {
    const small = computeMemoryStrength({ nodes: 10, patterns: 50, episodes: 20 }, 0.8);
    const large = computeMemoryStrength({ nodes: 100, patterns: 500, episodes: 200 }, 0.8);
    expect(large.score).toBeGreaterThan(small.score);
  });

  test('a success-rate collapse pulls the score down (score can move both ways)', () => {
    const healthy = computeMemoryStrength({ nodes: 50, patterns: 300, episodes: 100 }, 0.95);
    const unhealthy = computeMemoryStrength({ nodes: 50, patterns: 300, episodes: 100 }, 0.2);
    expect(unhealthy.score).toBeLessThan(healthy.score - 15);
  });

  test('empty memory is a beginner, not an expert', () => {
    const result = computeMemoryStrength({ nodes: 0, patterns: 0, episodes: 0 }, 0);
    expect(result.score).toBe(0);
    expect(result.level).toBe('beginner');
  });

  test('score never exceeds 100 and levels follow the band thresholds', () => {
    const result = computeMemoryStrength({ nodes: 100000, patterns: 100000, episodes: 100000 }, 1);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.level).toBe('expert');
  });
});
