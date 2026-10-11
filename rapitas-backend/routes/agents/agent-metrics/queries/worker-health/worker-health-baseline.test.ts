/**
 * worker-health-baseline unit tests
 *
 * Covers the robust z-score (median/MAD), the weighted composite score, and
 * the degenerate cases the plan's premortem calls out: sparse samples, MAD=0.
 */
import { describe, test, expect } from 'bun:test';
import { median, mad, robustZ, compositeScore } from './worker-health-baseline';
import { WORKER_HEALTH_CONFIG } from './worker-health-config';

describe('median / mad', () => {
  test('median of odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  test('mad is the median absolute deviation', () => {
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
  });
});

describe('robustZ', () => {
  test('returns null when fewer than 3 valid samples', () => {
    expect(robustZ(5, [1, 2, null, null], 1)).toBeNull();
  });
  test('computes (x - median) / (1.4826 * MAD)', () => {
    const z = robustZ(10, [4, 5, 6, 5], 0.1);
    // median 5, MAD 0.5 => sigma 0.7413
    expect(z).toBeCloseTo((10 - 5) / (1.4826 * 0.5), 5);
  });
  test('stays finite when MAD is 0 by falling back to the floor', () => {
    const z = robustZ(3, [0, 0, 0, 0], 1);
    expect(z).toBe(3);
    expect(Number.isFinite(z as number)).toBe(true);
  });
  test('returns null for a null current value', () => {
    expect(robustZ(null, [1, 2, 3, 4], 1)).toBeNull();
  });
  test('accepts exactly 3 valid samples', () => {
    expect(robustZ(2, [1, 1, 1, null], 1)).toBe(1);
  });
});

describe('compositeScore', () => {
  const w = WORKER_HEALTH_CONFIG.weights;
  test('weights sum to 1', () => {
    const sum = Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
  test('improvement in one metric does not cancel a regression in another', () => {
    // completions far ABOVE baseline (z=+4, good), timeoutRate z=+2 (bad)
    const score = compositeScore(
      { completions: 4, timeoutRate: 2, retryRate: 0, restarts: 0 },
      w,
    ) as number;
    expect(score).toBeCloseTo(0.25 * 2, 10);
  });
  test('completions below baseline counts as deterioration', () => {
    const score = compositeScore(
      { completions: -3, timeoutRate: 0, retryRate: 0, restarts: 0 },
      w,
    ) as number;
    expect(score).toBeCloseTo(0.25 * 3, 10);
  });
  test('clips each metric at the configured cap', () => {
    const score = compositeScore(
      { completions: 0, timeoutRate: 100, retryRate: 0, restarts: 0 },
      w,
    ) as number;
    expect(score).toBeCloseTo(0.25 * WORKER_HEALTH_CONFIG.zClip, 10);
  });
  test('returns null when any metric is pending (null)', () => {
    expect(
      compositeScore({ completions: 1, timeoutRate: null, retryRate: 0, restarts: 0 }, w),
    ).toBeNull();
  });
});
