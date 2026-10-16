/**
 * types
 *
 * Mirrors the GET /agent-metrics/pareto-frontier and
 * /agent-metrics/pareto-frontier/recommend response contracts from
 * rapitas-backend/routes/agents/agent-metrics/queries/pareto-frontier.
 * Not responsible for any client-side derived/formatted shapes.
 */

export type WorkflowType = 'lightweight' | 'standard' | 'comprehensive' | 'unknown';
export type ComplexityFilter = 'all' | 'low' | 'medium' | 'high';
export type GoalKind = 'successRate' | 'throughput' | 'cost';
export type RecommendationReason =
  | 'ok'
  | 'already_met'
  | 'insufficient_data'
  | 'target_unreachable';

/** Point estimate plus its 95% confidence interval. */
export interface IntervalEstimate {
  value: number;
  ciLow: number;
  ciHigh: number;
}

export interface SegmentBaseline {
  sampleSize: number;
  reliable: boolean;
  /** Percent 0-100. */
  successRate: IntervalEstimate;
  /** Mean milliseconds. */
  executionTimeMs: IntervalEstimate;
  /** Mean USD per execution (resource proxy). */
  costUsd: IntervalEstimate;
}

export interface ParetoPoint extends SegmentBaseline {
  key: string;
  parameterSet: { role: string; model: string };
  successCount: number;
  avgTokens: number;
  paretoOptimal: boolean;
}

export interface ParetoSegment {
  workflowType: WorkflowType;
  role: string;
  sampleSize: number;
  baseline: SegmentBaseline;
  points: ParetoPoint[];
}

export interface ParetoMetricsInfo {
  resourceAxis: 'costUsd';
  cpuMemoryAvailable: boolean;
  confidenceLevel: number;
  minReliableSamples: number;
}

export interface ParetoFilters {
  complexityBand: ComplexityFilter;
  role: string;
}

export interface ParetoFrontierResult {
  windowDays: number;
  from: string;
  to: string;
  totalExecutions: number;
  filters: ParetoFilters;
  metrics: ParetoMetricsInfo;
  segments: ParetoSegment[];
}

export interface ParetoGoal {
  kind: GoalKind;
  value: number;
}

export interface RecommendationProjection {
  monthlyVolume: number;
  deltaCostUsdPerMonth: number;
  deltaTimeMsPerExecution: number;
  deltaMonthlyHours: number;
  deltaSuccessRatePoints: number;
}

export interface SegmentRecommendation {
  workflowType: WorkflowType;
  role: string;
  feasible: boolean;
  reason: RecommendationReason;
  baseline: SegmentBaseline;
  recommended: ParetoPoint | null;
  bestAlternative: ParetoPoint | null;
  projection: RecommendationProjection | null;
  confidence: number;
}

export interface ParetoRecommendationResult {
  goal: ParetoGoal;
  windowDays: number;
  filters: ParetoFilters;
  metrics: ParetoMetricsInfo;
  recommendations: SegmentRecommendation[];
}

/** Client-side filter state driving both endpoints. */
export interface ParetoQueryFilters {
  days: number;
  complexityBand: ComplexityFilter;
  role: string;
}
