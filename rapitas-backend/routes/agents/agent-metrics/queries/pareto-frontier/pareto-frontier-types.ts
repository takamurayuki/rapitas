/**
 * Pareto Frontier Types
 *
 * Shared contracts for the multi-objective (execution time / success rate /
 * resource cost) frontier aggregation and the goal-driven recommendation
 * engine. Not responsible for any computation.
 */

/** Task.workflowMode value, or `unknown` when the execution has no task link. */
export type WorkflowType = 'lightweight' | 'standard' | 'comprehensive' | 'unknown';

/** Complexity band derived from Task.complexityScore (0-100). */
export type ComplexityBand = 'low' | 'medium' | 'high';

/** Complexity band selector accepted by the API (`all` = no split). */
export type ComplexityFilter = ComplexityBand | 'all';

/** Point estimate plus its 95% confidence interval. */
export interface IntervalEstimate {
  value: number;
  ciLow: number;
  ciHigh: number;
}

/** The tunable parameter set a frontier point represents. */
export interface ParetoParameterSet {
  /** Workflow role (`researcher`, `implementer`, ...) the model is assigned to. */
  role: string;
  /** Model actually invoked for the executions (AgentExecution.modelName). */
  model: string;
}

/** Aggregate of one segment's executions as they currently run (the current mix). */
export interface SegmentBaseline {
  sampleSize: number;
  /** Whether sampleSize reached MIN_RELIABLE_SAMPLES. */
  reliable: boolean;
  /** Percent, 0-100. */
  successRate: IntervalEstimate;
  /** Mean wall-clock ms per execution (rows with a recorded duration only). */
  executionTimeMs: IntervalEstimate;
  /** Mean USD per execution — the resource-consumption proxy (see ParetoMetricsInfo). */
  costUsd: IntervalEstimate;
}

/** One candidate parameter set inside a segment. */
export interface ParetoPoint extends SegmentBaseline {
  /** `${role}/${model}` — stable identifier used by the UI. */
  key: string;
  parameterSet: ParetoParameterSet;
  successCount: number;
  avgTokens: number;
  /** True when no other reliable point dominates it on all three objectives. */
  paretoOptimal: boolean;
}

/** One Pareto curve: executions of one role inside one workflow type. */
export interface ParetoSegment {
  workflowType: WorkflowType;
  role: string;
  sampleSize: number;
  baseline: SegmentBaseline;
  points: ParetoPoint[];
}

/** Describes which columns feed each objective so the UI can label axes honestly. */
export interface ParetoMetricsInfo {
  /** Column used as the resource-consumption objective. */
  resourceAxis: 'costUsd';
  /** False: AgentExecution records no CPU/memory telemetry, so cost stands in for it. */
  cpuMemoryAvailable: false;
  confidenceLevel: 0.95;
  minReliableSamples: number;
}

/** Filters the frontier was computed under. */
export interface ParetoFilters {
  complexityBand: ComplexityFilter;
  role: string;
}

/** GET /agent-metrics/pareto-frontier response payload. */
export interface ParetoFrontierResult {
  windowDays: number;
  from: string;
  to: string;
  totalExecutions: number;
  filters: ParetoFilters;
  metrics: ParetoMetricsInfo;
  segments: ParetoSegment[];
}

/** Business goal kinds the recommendation engine understands. */
export type GoalKind = 'successRate' | 'throughput' | 'cost';

/**
 * A business goal. `value` semantics per kind:
 * successRate = target percent; throughput = improvement percent;
 * cost = reduction percent.
 */
export interface ParetoGoal {
  kind: GoalKind;
  value: number;
}

/** Why a recommendation is or is not available. */
export type RecommendationReason =
  | 'ok'
  | 'already_met'
  | 'insufficient_data'
  | 'target_unreachable';

/** Projected monthly impact of switching a segment to the recommended point. */
export interface RecommendationProjection {
  /** Executions per 30 days extrapolated from the window. */
  monthlyVolume: number;
  deltaCostUsdPerMonth: number;
  deltaTimeMsPerExecution: number;
  deltaMonthlyHours: number;
  deltaSuccessRatePoints: number;
}

/** Recommendation for one segment. */
export interface SegmentRecommendation {
  workflowType: WorkflowType;
  role: string;
  feasible: boolean;
  reason: RecommendationReason;
  baseline: SegmentBaseline;
  /** Point that satisfies the goal at the lowest secondary cost, or null. */
  recommended: ParetoPoint | null;
  /** Closest reliable point when the goal is unreachable, or null. */
  bestAlternative: ParetoPoint | null;
  projection: RecommendationProjection | null;
  /** 0-1, saturates at TARGET_SAMPLES executions behind the recommendation. */
  confidence: number;
}

/** GET /agent-metrics/pareto-frontier/recommend response payload. */
export interface ParetoRecommendationResult {
  goal: ParetoGoal;
  windowDays: number;
  filters: ParetoFilters;
  metrics: ParetoMetricsInfo;
  recommendations: SegmentRecommendation[];
}

/** Minimal AgentExecution row shape consumed by the frontier builder. */
export interface ParetoExecutionRow {
  status: string;
  modelName: string | null;
  tokensUsed: unknown;
  costUsd: unknown;
  executionTimeMs: unknown;
  session?: {
    mode: string | null;
    config?: {
      task?: { workflowMode: string | null; complexityScore: number | null } | null;
    } | null;
  } | null;
}
