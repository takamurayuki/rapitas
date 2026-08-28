/**
 * Pareto Recommendation
 *
 * Goal-driven what-if engine: given a business goal (target success rate,
 * throughput improvement, or cost reduction) it picks, per segment, the
 * reliable parameter set that satisfies the goal at the lowest secondary
 * cost and projects the monthly delta against the segment's current mix.
 * Correlational only — executions were never randomised across models, so
 * the projection is an estimate, not a causal guarantee.
 */

import {
  PARETO_METRICS_INFO,
  fetchParetoRows,
  buildParetoSegments,
  monthlyVolume,
  type ParetoFrontierOptions,
} from './pareto-frontier-query';
import { round, sampleConfidence } from './pareto-statistics';
import type {
  ParetoGoal,
  ParetoPoint,
  ParetoRecommendationResult,
  ParetoSegment,
  RecommendationProjection,
  SegmentBaseline,
  SegmentRecommendation,
} from './pareto-frontier-types';

/**
 * A throughput/cost switch may not cost more than this many success-rate
 * points versus the current mix (same tolerance as cost-optimization).
 */
const MAX_SUCCESS_RATE_DROP_POINTS = 5;

/** Candidate filter and tie-break order for one goal kind. */
interface GoalStrategy {
  /** True when the point satisfies the goal against this baseline. */
  satisfies: (point: ParetoPoint, baseline: SegmentBaseline) => boolean;
  /** Secondary objective minimised among satisfying points. */
  rank: (point: ParetoPoint) => number;
  /** Distance to the goal, used to pick the best alternative when unreachable. */
  gap: (point: ParetoPoint) => number;
  /** True when the current mix already satisfies the goal. */
  alreadyMet: (baseline: SegmentBaseline) => boolean;
}

function successGuard(point: ParetoPoint, baseline: SegmentBaseline): boolean {
  return point.successRate.value >= baseline.successRate.value - MAX_SUCCESS_RATE_DROP_POINTS;
}

/**
 * Resolves the goal into concrete predicates.
 *
 * @param goal - Business goal / ビジネス目標
 * @returns Strategy for this goal kind / 判定戦略
 */
export function goalStrategy(goal: ParetoGoal): GoalStrategy {
  switch (goal.kind) {
    case 'successRate':
      return {
        satisfies: (p) => p.successRate.value >= goal.value,
        rank: (p) => p.costUsd.value * 1e6 + p.executionTimeMs.value,
        gap: (p) => goal.value - p.successRate.value,
        alreadyMet: (b) => b.successRate.value >= goal.value,
      };
    case 'throughput':
      return {
        satisfies: (p, b) =>
          p.executionTimeMs.value <= targetTimeMs(b, goal.value) && successGuard(p, b),
        rank: (p) => p.costUsd.value,
        gap: (p) => p.executionTimeMs.value,
        alreadyMet: () => false,
      };
    case 'cost':
      return {
        satisfies: (p, b) =>
          p.costUsd.value <= b.costUsd.value * (1 - goal.value / 100) && successGuard(p, b),
        rank: (p) => p.executionTimeMs.value,
        gap: (p) => p.costUsd.value,
        alreadyMet: () => false,
      };
  }
}

/**
 * Mean execution time the segment must reach for a throughput gain of
 * `improvementPercent` at constant concurrency.
 *
 * @param baseline - Current mix / 現状
 * @param improvementPercent - Desired throughput gain / 目標向上率
 * @returns Target mean ms / 目標平均時間
 */
export function targetTimeMs(baseline: SegmentBaseline, improvementPercent: number): number {
  const factor = 1 + Math.max(0, improvementPercent) / 100;
  return baseline.executionTimeMs.value / factor;
}

function projection(
  baseline: SegmentBaseline,
  point: ParetoPoint,
  segmentSize: number,
  windowDays: number,
): RecommendationProjection {
  const volume = monthlyVolume(segmentSize, windowDays);
  const deltaTime = point.executionTimeMs.value - baseline.executionTimeMs.value;
  return {
    monthlyVolume: volume,
    deltaCostUsdPerMonth: round((point.costUsd.value - baseline.costUsd.value) * volume, 2),
    deltaTimeMsPerExecution: Math.round(deltaTime),
    deltaMonthlyHours: round((deltaTime * volume) / 3_600_000, 2),
    deltaSuccessRatePoints: round(point.successRate.value - baseline.successRate.value, 2),
  };
}

/**
 * Recommends a parameter set for one segment. Pure; safe to unit test.
 *
 * @param segment - Frontier segment / セグメント
 * @param goal - Business goal / ビジネス目標
 * @param windowDays - Window the segment was aggregated over / 集計日数
 * @returns Recommendation (never throws) / 推奨結果
 */
export function recommendForSegment(
  segment: ParetoSegment,
  goal: ParetoGoal,
  windowDays: number,
): SegmentRecommendation {
  const base: SegmentRecommendation = {
    workflowType: segment.workflowType,
    role: segment.role,
    feasible: false,
    reason: 'insufficient_data',
    baseline: segment.baseline,
    recommended: null,
    bestAlternative: null,
    projection: null,
    confidence: 0,
  };
  const reliable = segment.points.filter((p) => p.reliable);
  if (!segment.baseline.reliable || reliable.length === 0) return base;

  const strategy = goalStrategy(goal);
  const satisfying = reliable
    .filter((p) => strategy.satisfies(p, segment.baseline))
    .sort((a, b) => strategy.rank(a) - strategy.rank(b));

  if (satisfying.length === 0) {
    const alternative = [...reliable].sort((a, b) => strategy.gap(a) - strategy.gap(b))[0];
    return {
      ...base,
      reason: 'target_unreachable',
      bestAlternative: alternative,
      projection: projection(segment.baseline, alternative, segment.sampleSize, windowDays),
      confidence: sampleConfidence(alternative.sampleSize),
    };
  }

  const recommended = satisfying[0];
  return {
    ...base,
    feasible: true,
    reason: strategy.alreadyMet(segment.baseline) ? 'already_met' : 'ok',
    recommended,
    projection: projection(segment.baseline, recommended, segment.sampleSize, windowDays),
    confidence: sampleConfidence(recommended.sampleSize),
  };
}

/**
 * Builds recommendations for every segment in the trailing window.
 *
 * @param options - Window and filters / 集計条件
 * @param goal - Business goal / ビジネス目標
 * @returns Recommendation payload / 推奨結果
 */
export async function getParetoRecommendation(
  options: ParetoFrontierOptions,
  goal: ParetoGoal,
): Promise<ParetoRecommendationResult> {
  const { rows } = await fetchParetoRows(options.windowDays);
  const segments = buildParetoSegments(rows, options);
  return {
    goal,
    windowDays: options.windowDays,
    filters: { complexityBand: options.complexityBand, role: options.role },
    metrics: PARETO_METRICS_INFO,
    recommendations: segments.map((s) => recommendForSegment(s, goal, options.windowDays)),
  };
}
