/**
 * prompt-comparison-metrics.test
 *
 * Verifies classifyFailureCause's 3-way split + success, aggregateArm's
 * infra_failure exclusion, and decideComparisonVerdict's boundary values.
 */
import { describe, it, expect } from 'bun:test';
import {
  classifyFailureCause,
  aggregateArm,
  decideComparisonVerdict,
  buildComparisonSummary,
  fisherExactOneSidedGreater,
  COMPARISON_MIN_SAMPLE,
} from './prompt-comparison-metrics';
import type { ComparisonCell, ComparisonRun } from './prompt-comparison-types';

function run(overrides: Partial<ComparisonRun> = {}): ComparisonRun {
  return {
    taskId: 1,
    executionId: 1,
    success: true,
    costUsd: 1,
    durationMs: 1000,
    failureCause: null,
    ...overrides,
  };
}

describe('classifyFailureCause', () => {
  it('returns null for a completed execution', () => {
    expect(classifyFailureCause({ status: 'completed', errorMessage: null })).toBeNull();
  });

  it('classifies cancelled as user_cancelled', () => {
    expect(classifyFailureCause({ status: 'cancelled', errorMessage: null })).toBe(
      'user_cancelled',
    );
  });

  it('classifies rate-limit/overload error messages as infra_failure', () => {
    expect(
      classifyFailureCause({ status: 'failed', errorMessage: 'Error: Overloaded (529)' }),
    ).toBe('infra_failure');
    expect(classifyFailureCause({ status: 'failed', errorMessage: 'connect ECONNRESET' })).toBe(
      'infra_failure',
    );
  });

  it('falls back to implementation_error for other failures', () => {
    expect(
      classifyFailureCause({ status: 'failed', errorMessage: 'TypeError: x is not a function' }),
    ).toBe('implementation_error');
  });
});

describe('aggregateArm', () => {
  it('excludes infra_failure runs from successRate/avgCostUsd/avgDurationMs', () => {
    const runs = [
      run({ success: true, costUsd: 1, durationMs: 1000 }),
      run({ success: false, costUsd: 0.5, durationMs: 500, failureCause: 'infra_failure' }),
    ];
    const agg = aggregateArm(runs);
    expect(agg.sampleSize).toBe(1);
    expect(agg.excludedForInfraFailure).toBe(1);
    expect(agg.successRate).toBe(1);
    expect(agg.avgCostUsd).toBe(1);
  });

  it('returns zeros when every run is excluded', () => {
    const agg = aggregateArm([run({ failureCause: 'infra_failure', success: false })]);
    expect(agg.sampleSize).toBe(0);
    expect(agg.successRate).toBe(0);
    expect(agg.excludedForInfraFailure).toBe(1);
  });
});

describe('decideComparisonVerdict', () => {
  const baseline = { baselineDurationMs: 100_000, excludedForInfraFailure: 0 };

  it('returns insufficient_data below COMPARISON_MIN_SAMPLE', () => {
    expect(
      decideComparisonVerdict({
        successRateDelta: 0.5,
        costDelta: 0,
        durationDeltaMs: 0,
        sampleSize: COMPARISON_MIN_SAMPLE - 1,
        currentSuccessCount: 1,
        currentFailureCount: 1,
        candidateSuccessCount: 2,
        candidateFailureCount: 1,
        ...baseline,
      }),
    ).toBe('insufficient_data');
  });

  it('returns regressed at the -0.05 boundary (inclusive)', () => {
    // n=20/arm: current 15/5 (0.75) vs candidate 14/6 (0.70) -> delta -0.05.
    // regressed is magnitude-only and never consults the significance gate.
    expect(
      decideComparisonVerdict({
        successRateDelta: -0.05,
        costDelta: 0,
        durationDeltaMs: 0,
        sampleSize: 20,
        currentSuccessCount: 15,
        currentFailureCount: 5,
        candidateSuccessCount: 14,
        candidateFailureCount: 6,
        ...baseline,
      }),
    ).toBe('regressed');
  });

  it('returns improved at the +0.05 boundary when the delta is also statistically significant', () => {
    // n=5/arm complete separation: current 0/5 (0%) vs candidate 5/0 (100%)
    // -> delta +1.0 (>= 0.05) and Fisher one-sided p ~= 0.0079 < 0.05.
    expect(
      decideComparisonVerdict({
        successRateDelta: 1,
        costDelta: 0,
        durationDeltaMs: 0,
        sampleSize: COMPARISON_MIN_SAMPLE,
        currentSuccessCount: 0,
        currentFailureCount: 5,
        candidateSuccessCount: 5,
        candidateFailureCount: 0,
        ...baseline,
      }),
    ).toBe('improved');
  });

  it('returns inconclusive at the +0.05 magnitude boundary without statistical significance', () => {
    // n=100/arm: current 50/50 (50%) vs candidate 55/45 (55%) -> delta +0.05
    // magnitude clears COMPARISON_IMPROVE_THRESHOLD, but the one-sided Fisher
    // p-value for a 5-point gap at n=100/arm is ~0.24, well above alpha=0.05.
    // This is the intended effect of adding the significance gate, not a
    // regression: previously this boundary returned "improved" from the
    // magnitude check alone.
    expect(
      decideComparisonVerdict({
        successRateDelta: 0.05,
        costDelta: 0,
        durationDeltaMs: 0,
        sampleSize: 100,
        currentSuccessCount: 50,
        currentFailureCount: 50,
        candidateSuccessCount: 55,
        candidateFailureCount: 45,
        ...baseline,
      }),
    ).toBe('inconclusive');
  });

  it('returns inconclusive when success improves but cost regresses beyond tolerance', () => {
    // magnitude/cost check short-circuits before the significance gate is
    // reached, so the counts here need not be significant on their own.
    expect(
      decideComparisonVerdict({
        successRateDelta: 0.2,
        costDelta: 5, // far beyond COMPARISON_COST_TOLERANCE
        durationDeltaMs: 0,
        sampleSize: 25,
        currentSuccessCount: 10,
        currentFailureCount: 15,
        candidateSuccessCount: 15,
        candidateFailureCount: 10,
        ...baseline,
      }),
    ).toBe('inconclusive');
  });

  it('returns inconclusive when the delta sits inside the noise band', () => {
    expect(
      decideComparisonVerdict({
        successRateDelta: 0.01,
        costDelta: 0,
        durationDeltaMs: 0,
        sampleSize: COMPARISON_MIN_SAMPLE,
        currentSuccessCount: 2,
        currentFailureCount: 3,
        candidateSuccessCount: 3,
        candidateFailureCount: 2,
        ...baseline,
      }),
    ).toBe('inconclusive');
  });

  it('returns improved for complete separation with the candidate ahead (0/5 vs 5/5)', () => {
    expect(
      decideComparisonVerdict({
        successRateDelta: 1,
        costDelta: 0,
        durationDeltaMs: 0,
        sampleSize: COMPARISON_MIN_SAMPLE,
        currentSuccessCount: 0,
        currentFailureCount: 5,
        candidateSuccessCount: 5,
        candidateFailureCount: 0,
        ...baseline,
      }),
    ).toBe('improved');
  });

  it('returns regressed for complete separation with the candidate behind (5/5 vs 0/5)', () => {
    expect(
      decideComparisonVerdict({
        successRateDelta: -1,
        costDelta: 0,
        durationDeltaMs: 0,
        sampleSize: COMPARISON_MIN_SAMPLE,
        currentSuccessCount: 5,
        currentFailureCount: 0,
        candidateSuccessCount: 0,
        candidateFailureCount: 5,
        ...baseline,
      }),
    ).toBe('regressed');
  });

  it('returns inconclusive when both arms are at 100% (no delta)', () => {
    expect(
      decideComparisonVerdict({
        successRateDelta: 0,
        costDelta: 0,
        durationDeltaMs: 0,
        sampleSize: COMPARISON_MIN_SAMPLE,
        currentSuccessCount: 5,
        currentFailureCount: 0,
        candidateSuccessCount: 5,
        candidateFailureCount: 0,
        ...baseline,
      }),
    ).toBe('inconclusive');
  });

  it('returns inconclusive when both arms are at 0% (no delta)', () => {
    expect(
      decideComparisonVerdict({
        successRateDelta: 0,
        costDelta: 0,
        durationDeltaMs: 0,
        sampleSize: COMPARISON_MIN_SAMPLE,
        currentSuccessCount: 0,
        currentFailureCount: 5,
        candidateSuccessCount: 0,
        candidateFailureCount: 5,
        ...baseline,
      }),
    ).toBe('inconclusive');
  });
});

describe('fisherExactOneSidedGreater', () => {
  it('matches the analytic value for complete separation (5/5 vs 0/5)', () => {
    // p = 1 / C(10,5) = 1/252
    expect(fisherExactOneSidedGreater(5, 0, 0, 5)).toBeCloseTo(1 / 252, 6);
  });

  it('returns 1 when both arms are at 0%', () => {
    expect(fisherExactOneSidedGreater(0, 5, 0, 5)).toBe(1);
  });

  it('returns 1 when one arm has zero samples (n1 === 0)', () => {
    expect(fisherExactOneSidedGreater(0, 0, 3, 2)).toBe(1);
  });

  it('returns 1 when one arm has zero samples (n2 === 0)', () => {
    expect(fisherExactOneSidedGreater(3, 2, 0, 0)).toBe(1);
  });
});

describe('buildComparisonSummary', () => {
  function cell(
    arm: ComparisonCell['arm'],
    knowledge: ComparisonCell['knowledge'],
    runs: ComparisonRun[],
  ): ComparisonCell {
    return { arm, knowledge, runs };
  }

  it('returns null when a with-knowledge cell is missing', () => {
    const cells = [cell('current', 'with', [run()])];
    expect(buildComparisonSummary(cells)).toBeNull();
  });

  it('computes deltas from the with-knowledge cells only', () => {
    const currentRuns = Array.from({ length: 5 }, () =>
      run({ success: false, costUsd: 1, durationMs: 1000 }),
    );
    const candidateRuns = Array.from({ length: 5 }, () =>
      run({ success: true, costUsd: 1, durationMs: 1000 }),
    );
    const cells = [
      cell('current', 'with', currentRuns),
      cell('candidate', 'with', candidateRuns),
      cell('current', 'without', []),
      cell('candidate', 'without', []),
    ];
    const summary = buildComparisonSummary(cells);
    expect(summary).not.toBeNull();
    expect(summary?.successRateDelta).toBe(1);
    expect(summary?.verdict).toBe('improved');
    expect(summary?.sampleSize).toBe(5);
    expect(summary?.pValue).not.toBeNull();
    expect(summary?.pValue ?? 1).toBeLessThan(0.05);
  });
});
