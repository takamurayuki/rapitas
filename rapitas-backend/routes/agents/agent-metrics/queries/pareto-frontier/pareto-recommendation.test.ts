/**
 * pareto-recommendation unit tests
 *
 * Verifies the success-rate cost estimate (90% -> 95%), the throughput and
 * cost goals, the insufficient-data / unreachable / already-met reasons, tie
 * handling, and the monthly projection arithmetic. All via the pure
 * recommendForSegment; getParetoRecommendation is covered through the
 * mocked Prisma path.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const findMany = mock(() => Promise.resolve([] as unknown[]));
mock.module('../../../../../config/database', () => ({
  prisma: {
    agentExecution: { findMany },
  },
}));

import {
  getParetoRecommendation,
  recommendForSegment,
  targetTimeMs,
} from './pareto-recommendation';
import type { ParetoPoint, ParetoSegment, SegmentBaseline } from './pareto-frontier-types';

function estimate(value: number, spread = 0) {
  return { value, ciLow: value - spread, ciHigh: value + spread };
}

function baseline(success: number, time: number, cost: number, sampleSize = 30): SegmentBaseline {
  return {
    sampleSize,
    reliable: sampleSize >= 5,
    successRate: estimate(success, 5),
    executionTimeMs: estimate(time, 1000),
    costUsd: estimate(cost, 0.05),
  };
}

function point(
  model: string,
  success: number,
  time: number,
  cost: number,
  sampleSize = 10,
): ParetoPoint {
  return {
    ...baseline(success, time, cost, sampleSize),
    key: `implementer/${model}`,
    parameterSet: { role: 'implementer', model },
    successCount: Math.round((success / 100) * sampleSize),
    avgTokens: 0,
    paretoOptimal: true,
  };
}

function segment(points: ParetoPoint[], base = baseline(90, 60_000, 0.5, 30)): ParetoSegment {
  return {
    workflowType: 'standard',
    role: 'implementer',
    sampleSize: base.sampleSize,
    baseline: base,
    points,
  };
}

beforeEach(() => {
  findMany.mockReset();
  findMany.mockImplementation(() => Promise.resolve([]));
});

describe('recommendForSegment — successRate goal (90% -> 95%)', () => {
  test('picks the cheapest reliable point reaching the target and prices the delta', () => {
    const seg = segment([
      point('sonnet', 90, 60_000, 0.5),
      point('opus', 97, 90_000, 1.5),
      point('opus-cheap-tie', 96, 80_000, 1.5),
      point('haiku', 80, 20_000, 0.1),
    ]);
    const rec = recommendForSegment(seg, { kind: 'successRate', value: 95 }, 30);

    expect(rec.feasible).toBe(true);
    expect(rec.reason).toBe('ok');
    // Same cost -> the faster point wins the tie.
    expect(rec.recommended?.parameterSet.model).toBe('opus-cheap-tie');
    expect(rec.projection).toEqual({
      monthlyVolume: 30,
      deltaCostUsdPerMonth: 30,
      deltaTimeMsPerExecution: 20_000,
      deltaMonthlyHours: 0.17,
      deltaSuccessRatePoints: 6,
    });
    expect(rec.confidence).toBe(0.5);
    expect(rec.bestAlternative).toBeNull();
  });

  test('reports target_unreachable with the closest alternative', () => {
    const seg = segment([point('sonnet', 90, 60_000, 0.5), point('haiku', 85, 20_000, 0.1)]);
    const rec = recommendForSegment(seg, { kind: 'successRate', value: 99 }, 30);
    expect(rec.feasible).toBe(false);
    expect(rec.reason).toBe('target_unreachable');
    expect(rec.recommended).toBeNull();
    expect(rec.bestAlternative?.parameterSet.model).toBe('sonnet');
    expect(rec.projection?.deltaSuccessRatePoints).toBe(0);
  });

  test('reports already_met when the current mix satisfies the target', () => {
    const seg = segment([point('sonnet', 96, 60_000, 0.5)], baseline(96, 60_000, 0.5));
    const rec = recommendForSegment(seg, { kind: 'successRate', value: 95 }, 30);
    expect(rec.feasible).toBe(true);
    expect(rec.reason).toBe('already_met');
  });

  test('reports insufficient_data when the baseline or every point is unreliable', () => {
    const thin = segment([point('sonnet', 100, 1000, 0.1, 2)], baseline(100, 1000, 0.1, 2));
    expect(recommendForSegment(thin, { kind: 'successRate', value: 95 }, 30).reason).toBe(
      'insufficient_data',
    );
    const noReliablePoints = segment([point('sonnet', 100, 1000, 0.1, 3)]);
    expect(
      recommendForSegment(noReliablePoints, { kind: 'successRate', value: 95 }, 30).reason,
    ).toBe('insufficient_data');
  });
});

describe('recommendForSegment — throughput goal', () => {
  test('targetTimeMs divides the baseline mean by the improvement factor', () => {
    expect(targetTimeMs(baseline(90, 120_000, 1), 20)).toBeCloseTo(100_000, 6);
    expect(targetTimeMs(baseline(90, 120_000, 1), 0)).toBe(120_000);
  });

  test('picks the cheapest point fast enough without dropping success > 5pt', () => {
    const seg = segment([
      point('sonnet', 90, 60_000, 0.5),
      point('haiku-fast-but-flaky', 80, 20_000, 0.1),
      point('haiku-fast', 86, 40_000, 0.2),
      point('opus-fast', 95, 30_000, 1.0),
    ]);
    const rec = recommendForSegment(seg, { kind: 'throughput', value: 20 }, 30);
    expect(rec.feasible).toBe(true);
    expect(rec.recommended?.parameterSet.model).toBe('haiku-fast');
    expect(rec.projection?.deltaTimeMsPerExecution).toBe(-20_000);
    expect(rec.projection?.deltaMonthlyHours).toBe(-0.17);
  });

  test('falls back to the fastest reliable point when unreachable', () => {
    const seg = segment([point('sonnet', 90, 60_000, 0.5), point('slow', 92, 70_000, 0.4)]);
    const rec = recommendForSegment(seg, { kind: 'throughput', value: 50 }, 30);
    expect(rec.reason).toBe('target_unreachable');
    expect(rec.bestAlternative?.parameterSet.model).toBe('sonnet');
  });
});

describe('recommendForSegment — cost goal', () => {
  test('picks the fastest point cheap enough without dropping success > 5pt', () => {
    const seg = segment([
      point('sonnet', 90, 60_000, 0.5),
      point('haiku-slow', 87, 50_000, 0.3),
      point('haiku', 86, 30_000, 0.35),
      point('haiku-flaky', 70, 10_000, 0.05),
    ]);
    const rec = recommendForSegment(seg, { kind: 'cost', value: 20 }, 30);
    expect(rec.feasible).toBe(true);
    expect(rec.recommended?.parameterSet.model).toBe('haiku');
    expect(rec.projection?.deltaCostUsdPerMonth).toBe(-4.5);
  });
});

describe('getParetoRecommendation', () => {
  test('returns one recommendation per segment with the goal echoed back', async () => {
    const rows = Array.from({ length: 6 }, () => ({
      status: 'completed',
      modelName: 'claude-sonnet-4-6',
      tokensUsed: 100,
      costUsd: 0.2,
      executionTimeMs: 10_000,
      session: {
        mode: 'workflow-researcher',
        config: { task: { workflowMode: 'lightweight', complexityScore: 10 } },
      },
    }));
    findMany.mockImplementation(() => Promise.resolve(rows));
    const result = await getParetoRecommendation(
      { windowDays: 30, complexityBand: 'all', role: 'all' },
      { kind: 'successRate', value: 95 },
    );
    expect(result.goal).toEqual({ kind: 'successRate', value: 95 });
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].reason).toBe('already_met');
    expect(result.recommendations[0].recommended?.parameterSet.model).toBe('claude-sonnet-4-6');
    expect(result.metrics.cpuMemoryAvailable).toBe(false);
  });
});
