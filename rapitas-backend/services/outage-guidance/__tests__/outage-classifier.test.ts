/**
 * outage-classifier tests — boundary values of the three-level verdict
 * (safe / risk / danger) and the p90 nearest-rank estimator.
 */
import { describe, test, expect } from 'bun:test';
import {
  classifyOutage,
  percentileNearestRank,
  estimateRecovery,
  computeBlastRatio,
  evaluateOutage,
} from '../outage-classifier';
import {
  DANGER_BLAST_RATIO,
  SAFE_BLAST_RATIO,
  SAFE_RECOVERY_RATIO,
  MIN_HISTORY_SAMPLES,
  type OutageInventory,
} from '../outage-guidance.types';

const T = 20;

describe('classifyOutage', () => {
  test('R == T is not danger (strict >)', () => {
    const r = classifyOutage({
      recoveryMinutes: T,
      toleranceMinutes: T,
      blastRatio: 0,
      historySamples: 5,
    });
    expect(r.verdict).toBe('risk');
    expect(r.reasons).toContain('narrow_margin');
  });

  test('R == T + 1 is danger', () => {
    const r = classifyOutage({
      recoveryMinutes: T + 1,
      toleranceMinutes: T,
      blastRatio: 0,
      historySamples: 5,
    });
    expect(r.verdict).toBe('danger');
    expect(r.reasons).toContain('recovery_exceeds_tolerance');
  });

  test('blast ratio == DANGER_BLAST_RATIO is danger even with fast recovery', () => {
    const r = classifyOutage({
      recoveryMinutes: 1,
      toleranceMinutes: T,
      blastRatio: DANGER_BLAST_RATIO,
      historySamples: 5,
    });
    expect(r.verdict).toBe('danger');
    expect(r.reasons).toEqual(['wide_blast_radius']);
  });

  test('blast ratio == SAFE_BLAST_RATIO is not safe', () => {
    const r = classifyOutage({
      recoveryMinutes: 1,
      toleranceMinutes: T,
      blastRatio: SAFE_BLAST_RATIO,
      historySamples: 5,
    });
    expect(r.verdict).toBe('risk');
    expect(r.reasons).toContain('wide_blast_radius');
  });

  test('R == 0.5T with 3 samples and narrow blast is safe', () => {
    const r = classifyOutage({
      recoveryMinutes: SAFE_RECOVERY_RATIO * T,
      toleranceMinutes: T,
      blastRatio: 0.1,
      historySamples: MIN_HISTORY_SAMPLES,
    });
    expect(r.verdict).toBe('safe');
    expect(r.reasons).toEqual(['within_safety_margin']);
  });

  test('2 samples cannot be safe and reports insufficient_history', () => {
    const r = classifyOutage({
      recoveryMinutes: 1,
      toleranceMinutes: T,
      blastRatio: 0,
      historySamples: MIN_HISTORY_SAMPLES - 1,
    });
    expect(r.verdict).toBe('risk');
    expect(r.reasons).toContain('insufficient_history');
  });

  test('requireHistory=false lifts the history suppression (ground-truth mode)', () => {
    const r = classifyOutage({
      recoveryMinutes: 1,
      toleranceMinutes: T,
      blastRatio: 0,
      historySamples: 0,
      requireHistory: false,
    });
    expect(r.verdict).toBe('safe');
  });
});

describe('percentileNearestRank', () => {
  test('p90 of 10 values is the 9th smallest', () => {
    expect(percentileNearestRank([10, 1, 9, 2, 8, 3, 7, 4, 6, 5], 0.9)).toBe(9);
  });
  test('p90 of 3 values is the max', () => {
    expect(percentileNearestRank([5, 20, 10], 0.9)).toBe(20);
  });
  test('throws on empty input', () => {
    expect(() => percentileNearestRank([], 0.9)).toThrow();
  });
});

describe('estimateRecovery', () => {
  test('uses p90 when history has >= 3 samples', () => {
    expect(estimateRecovery(30, [4, 6, 8])).toEqual({ minutes: 8, samples: 3 });
  });
  test('falls back to max(declared, history max) below 3 samples', () => {
    expect(estimateRecovery(10, [25])).toEqual({ minutes: 25, samples: 1 });
    expect(estimateRecovery(10, [])).toEqual({ minutes: 10, samples: 0 });
  });
});

describe('computeBlastRatio', () => {
  test('normalizes by the other services', () => {
    expect(computeBlastRatio(3, 13)).toBe(0.25);
  });
  test('single-service inventory yields 0 (no division by zero)', () => {
    expect(computeBlastRatio(0, 1)).toBe(0);
  });
});

describe('evaluateOutage', () => {
  const inv: OutageInventory = {
    version: 1,
    services: [
      { id: 'edge', name: 'Edge', layer: 'api', slaMinutes: 15, declaredRecoveryMinutes: 5 },
      { id: 'db', name: 'DB', layer: 'db', slaMinutes: 60, declaredRecoveryMinutes: 20 },
      { id: 'job', name: 'Job', layer: 'worker', slaMinutes: 600, declaredRecoveryMinutes: 30 },
    ],
    dependencies: [{ from: 'edge', to: 'db', kind: 'db_query' }],
    incidents: [],
  };

  test('tolerance is the lowest SLA among target and impacted services', () => {
    const a = evaluateOutage(inv, 'db', []);
    expect(a.toleranceMinutes).toBe(15);
    expect(a.estimatedRecoveryMinutes).toBe(20);
    expect(a.verdict).toBe('danger');
    expect(a.affected).toEqual([{ serviceId: 'edge', depth: 1, path: ['edge', 'db'] }]);
    expect(a.blastRatio).toBe(0.5);
  });

  test('isolated worker with enough fast history is safe', () => {
    const a = evaluateOutage(inv, 'job', [20, 25, 30]);
    expect(a.verdict).toBe('safe');
    expect(a.blastRatio).toBe(0);
    expect(a.affected).toEqual([]);
  });
});
