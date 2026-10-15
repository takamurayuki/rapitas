/**
 * pr-risk-metrics test
 *
 * Pins the monthly precision/recall/FPR arithmetic (null on zero denominators),
 * the threshold proposal (FPR ≤ 0.2, max F1, ties → higher) and the adopt /
 * demote rules of the periodic threshold review.
 */
import { describe, it, expect } from 'bun:test';
import {
  computeMonthlyMetric,
  proposeThreshold,
  shouldAdopt,
  shouldDemote,
  monthKey,
  previousMonthKey,
  monthBounds,
  isMonthlyReviewDue,
} from './pr-risk-metrics';
import type { LabelledPrediction } from './pr-risk-types';

const row = (
  score: number,
  label: 'success' | 'failure',
  thresholdUsed = 0.5,
): LabelledPrediction => ({
  score,
  label,
  thresholdUsed,
});

describe('computeMonthlyMetric', () => {
  it('computes the confusion matrix against thresholdUsed', () => {
    const m = computeMonthlyMetric([
      row(0.9, 'failure'), // TP
      row(0.6, 'success'), // FP
      row(0.2, 'failure'), // FN
      row(0.1, 'success'), // TN
      row(0.5, 'failure'), // TP (≥ threshold)
    ]);
    expect(m).toMatchObject({ sample: 5, tp: 2, fp: 1, fn: 1, tn: 1 });
    expect(m.precision).toBeCloseTo(2 / 3, 12);
    expect(m.recall).toBeCloseTo(2 / 3, 12);
    expect(m.fpr).toBeCloseTo(1 / 2, 12);
  });

  it('returns null (not 0) for undefined ratios', () => {
    const empty = computeMonthlyMetric([]);
    expect(empty).toMatchObject({ sample: 0, precision: null, recall: null, fpr: null });
    const onlyNegatives = computeMonthlyMetric([row(0.1, 'success')]);
    expect(onlyNegatives.precision).toBeNull();
    expect(onlyNegatives.recall).toBeNull();
    expect(onlyNegatives.fpr).toBe(0);
  });
});

describe('proposeThreshold', () => {
  const separable = (n: number): LabelledPrediction[] =>
    Array.from({ length: n }, (_, i) => (i < 4 ? row(0.8, 'failure') : row(0.2, 'success')));

  it('refuses with insufficient_labels below 20 samples', () => {
    expect(proposeThreshold(separable(19))).toEqual({
      proposed: null,
      reason: 'insufficient_labels',
    });
  });

  it('refuses with insufficient_labels when there are no failures', () => {
    const rows = Array.from({ length: 25 }, () => row(0.3, 'success'));
    expect(proposeThreshold(rows)).toEqual({ proposed: null, reason: 'insufficient_labels' });
  });

  it('picks the highest threshold among the max-F1 ties at 20 samples', () => {
    // Every t in (0.2, 0.8] separates perfectly (F1 = 1) → highest = 0.8
    const r = proposeThreshold(separable(20));
    expect(r.proposed).toBeCloseTo(0.8, 12);
    expect(r.reason).toBe('max_f1_within_fpr');
  });

  it('never proposes a threshold whose FPR exceeds 0.2', () => {
    // Failures and 10 successes share 0.7; only t > 0.7 keeps FPR ≤ 0.2 but then F1 = 0
    const rows = [
      ...Array.from({ length: 5 }, () => row(0.7, 'failure')),
      ...Array.from({ length: 10 }, () => row(0.7, 'success')),
      ...Array.from({ length: 10 }, () => row(0.1, 'success')),
    ];
    const r = proposeThreshold(rows);
    expect(r).toEqual({ proposed: null, reason: 'no_candidate_within_fpr' });
  });
});

describe('shouldAdopt', () => {
  const base = { stage: 'auto' as const, modelVersion: 1, proposed: 0.7, current: 0.5 };

  it('adopts only in auto with a trained model and a ≥ 0.05 move', () => {
    expect(shouldAdopt(base)).toBe(true);
    expect(shouldAdopt({ ...base, stage: 'hold' })).toBe(false);
    expect(shouldAdopt({ ...base, stage: 'display' })).toBe(false);
    expect(shouldAdopt({ ...base, modelVersion: 0 })).toBe(false);
    expect(shouldAdopt({ ...base, proposed: null })).toBe(false);
    expect(shouldAdopt({ ...base, proposed: 0.54 })).toBe(false);
    expect(shouldAdopt({ ...base, proposed: 0.55 })).toBe(true);
  });
});

describe('shouldDemote', () => {
  it('demotes auto when precision < 0.3 on ≥ 20 samples', () => {
    expect(shouldDemote({ stage: 'auto', sample: 20, precision: 0.29 })).toBe(true);
    expect(shouldDemote({ stage: 'auto', sample: 19, precision: 0.1 })).toBe(false);
    expect(shouldDemote({ stage: 'auto', sample: 30, precision: 0.3 })).toBe(false);
    expect(shouldDemote({ stage: 'auto', sample: 30, precision: null })).toBe(false);
    expect(shouldDemote({ stage: 'hold', sample: 30, precision: 0.1 })).toBe(false);
  });
});

describe('month helpers (UTC)', () => {
  it('formats and steps months in UTC', () => {
    expect(monthKey(new Date('2026-09-30T23:59:59Z'))).toBe('2026-09');
    expect(previousMonthKey(new Date('2026-01-10T00:00:00Z'))).toBe('2025-12');
    const { start, end } = monthBounds('2026-02');
    expect(start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('waits 72h into the month before the previous month is due', () => {
    expect(isMonthlyReviewDue(new Date('2026-09-03T23:59:59Z'))).toBe(false);
    expect(isMonthlyReviewDue(new Date('2026-09-04T00:00:00Z'))).toBe(true);
  });
});
