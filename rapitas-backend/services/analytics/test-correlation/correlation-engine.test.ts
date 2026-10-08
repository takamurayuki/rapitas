/**
 * correlation-engine.test.ts
 *
 * Unit tests for services/analytics/test-correlation/correlation-engine.ts.
 * Covers Pearson correlation edge cases, the t-distribution p-value against
 * known critical-value tables, confidence labeling, and matrix construction.
 */
import { describe, test, expect } from 'bun:test';
import {
  buildCorrelationMatrix,
  computePearson,
  confidenceLevel,
  pValueForPearsonR,
} from './correlation-engine';
import type { RunRecord } from './test-correlation.types';

describe('computePearson', () => {
  test('returns 1 for perfectly positively correlated vectors', () => {
    expect(computePearson([0, 1, 0, 1], [0, 1, 0, 1])).toBeCloseTo(1, 10);
  });

  test('returns -1 for perfectly negatively correlated vectors', () => {
    expect(computePearson([0, 1, 0, 1], [1, 0, 1, 0])).toBeCloseTo(-1, 10);
  });

  test('returns 0 for uncorrelated vectors', () => {
    expect(computePearson([1, 1, 0, 0], [1, 0, 1, 0])).toBeCloseTo(0, 10);
  });

  test('returns null when sample size is 0', () => {
    expect(computePearson([], [])).toBeNull();
  });

  test('returns null when sample size is 1', () => {
    expect(computePearson([1], [1])).toBeNull();
  });

  test('returns null when x has zero variance (division by zero guard)', () => {
    expect(computePearson([1, 1, 1], [0, 1, 0])).toBeNull();
  });

  test('returns null when y has zero variance', () => {
    expect(computePearson([0, 1, 0], [1, 1, 1])).toBeNull();
  });
});

describe('pValueForPearsonR — known t-distribution critical values', () => {
  // df = n - 2 = 10 → two-tailed critical t at alpha=0.05 is 2.228 (standard table value).
  // r = t / sqrt(t^2 + df) converts a target t back to the correlation that produces it.
  function rForT(t: number, df: number): number {
    return t / Math.sqrt(t * t + df);
  }

  test('p is just above 0.05 for t slightly below the df=10 critical value (2.228)', () => {
    const r = rForT(2.2, 10);
    const p = pValueForPearsonR(r, 12); // n - 2 = 10
    expect(p).not.toBeNull();
    expect(p as number).toBeGreaterThan(0.05);
  });

  test('p is just below 0.05 for t slightly above the df=10 critical value (2.228)', () => {
    const r = rForT(2.3, 10);
    const p = pValueForPearsonR(r, 12);
    expect(p).not.toBeNull();
    expect(p as number).toBeLessThan(0.05);
  });

  test('p is exactly 1 for r=0 (no relationship)', () => {
    expect(pValueForPearsonR(0, 12)).toBeCloseTo(1, 5);
  });

  test('p is 0 for |r|=1 (perfect correlation)', () => {
    expect(pValueForPearsonR(1, 12)).toBe(0);
    expect(pValueForPearsonR(-1, 12)).toBe(0);
  });

  test('returns null when df <= 0 (n < 3)', () => {
    expect(pValueForPearsonR(0.5, 2)).toBeNull();
    expect(pValueForPearsonR(0.5, 1)).toBeNull();
  });
});

describe('confidenceLevel', () => {
  test('low when sample size is below 5, even with a significant p-value', () => {
    expect(confidenceLevel(4, 0.001)).toBe('low');
  });

  test('low when sample size is high but a strong correlation has no computed p-value (null)', () => {
    expect(confidenceLevel(20, null)).toBe('low');
  });

  test('high when sample size >= 10 and p < 0.01', () => {
    expect(confidenceLevel(10, 0.005)).toBe('high');
  });

  test('medium when p < 0.05 but sample size is below the high threshold', () => {
    expect(confidenceLevel(6, 0.03)).toBe('medium');
  });

  test('low when p >= 0.05 regardless of sample size', () => {
    expect(confidenceLevel(50, 0.2)).toBe('low');
  });
});

describe('buildCorrelationMatrix', () => {
  function run(overrides: Partial<RunRecord>): RunRecord {
    return {
      runId: 'r',
      timestamp: '2026-01-01T00:00:00.000Z',
      source: 'local',
      commitSha: null,
      changedFiles: [],
      testResults: [],
      environment: { platform: 'win32', runtimeVersion: '1.0.0' },
      ...overrides,
    };
  }

  test('produces one cell per (changedFile, testFile) pair with a positive correlation when they co-occur', () => {
    const runs: RunRecord[] = [
      run({ changedFiles: ['a.ts'], testResults: [{ file: 'a.test.ts', status: 'fail' }] }),
      run({ changedFiles: [], testResults: [{ file: 'a.test.ts', status: 'pass' }] }),
      run({ changedFiles: ['a.ts'], testResults: [{ file: 'a.test.ts', status: 'fail' }] }),
      run({ changedFiles: [], testResults: [{ file: 'a.test.ts', status: 'pass' }] }),
    ];
    const cells = buildCorrelationMatrix(runs);
    expect(cells).toHaveLength(1);
    expect(cells[0].changedFile).toBe('a.ts');
    expect(cells[0].testFile).toBe('a.test.ts');
    expect(cells[0].correlation).toBeCloseTo(1, 10);
    expect(cells[0].sampleSize).toBe(4);
  });

  test('excludes skipped runs from a pair sample', () => {
    const runs: RunRecord[] = [
      run({ changedFiles: ['a.ts'], testResults: [{ file: 'a.test.ts', status: 'skip' }] }),
      run({ changedFiles: ['a.ts'], testResults: [{ file: 'a.test.ts', status: 'fail' }] }),
    ];
    const cells = buildCorrelationMatrix(runs);
    expect(cells[0].sampleSize).toBe(1);
    expect(cells[0].correlation).toBeNull();
  });

  test('sets correlation null with sampleSize only when fewer than 2 samples exist', () => {
    const runs: RunRecord[] = [
      run({ changedFiles: ['a.ts'], testResults: [{ file: 'a.test.ts', status: 'fail' }] }),
    ];
    const cells = buildCorrelationMatrix(runs);
    expect(cells[0].correlation).toBeNull();
    expect(cells[0].sampleSize).toBe(1);
  });

  test('marks nonDeterministic true when the flake rate map has a positive rate for the test file', () => {
    const runs: RunRecord[] = [
      run({ changedFiles: ['a.ts'], testResults: [{ file: 'a.test.ts', status: 'fail' }] }),
    ];
    const cells = buildCorrelationMatrix(runs, { flakeRates: { 'a.test.ts': 0.3 } });
    expect(cells[0].nonDeterministic).toBe(true);
  });

  test('marks nonDeterministic false when there is no flake-rate entry for the test file', () => {
    const runs: RunRecord[] = [
      run({ changedFiles: ['a.ts'], testResults: [{ file: 'a.test.ts', status: 'fail' }] }),
    ];
    const cells = buildCorrelationMatrix(runs);
    expect(cells[0].nonDeterministic).toBe(false);
  });
});
