/**
 * Pareto Frontier — barrel
 *
 * Re-exports the public API of the multi-objective frontier module split
 * across types / statistics / dominance / query / recommendation.
 */

export type {
  WorkflowType,
  ComplexityBand,
  ComplexityFilter,
  IntervalEstimate,
  ParetoParameterSet,
  SegmentBaseline,
  ParetoPoint,
  ParetoSegment,
  ParetoMetricsInfo,
  ParetoFilters,
  ParetoFrontierResult,
  GoalKind,
  ParetoGoal,
  RecommendationReason,
  RecommendationProjection,
  SegmentRecommendation,
  ParetoRecommendationResult,
  ParetoExecutionRow,
} from './pareto-frontier-types';
export {
  MIN_RELIABLE_SAMPLES,
  TARGET_SAMPLES,
  wilsonInterval,
  meanInterval,
  sampleConfidence,
} from './pareto-statistics';
export { dominates, markParetoOptimal } from './pareto-dominance';
export type { ParetoFrontierOptions } from './pareto-frontier-query';
export {
  PARETO_METRICS_INFO,
  buildParetoSegments,
  getParetoFrontier,
  monthlyVolume,
  toComplexityBand,
  toWorkflowType,
} from './pareto-frontier-query';
export {
  goalStrategy,
  recommendForSegment,
  getParetoRecommendation,
  targetTimeMs,
} from './pareto-recommendation';
