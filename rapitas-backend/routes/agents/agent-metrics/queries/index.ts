/**
 * Agent Metrics Queries
 *
 * Barrel export for the agent-metrics query modules: overview/trends,
 * performance comparison, self-observation, usage breakdown, utilization,
 * cost optimization, and repair-convergence aggregations.
 */

export {
  buildDateWhereClause,
  getAgentMetrics,
  getExecutionTrends,
  getMetricsOverview,
  prisma,
} from './overview';

export { getAgentPerformanceComparison } from './performance';

export type { DailyCostPoint, ModelMixEntry, SelfObservationSummary } from './observation';
export { getSelfObservationSummary } from './observation';

export type {
  RoleUsageEntry,
  DailyRoleCostPoint,
  CliAgentUsageEntry,
  AgentUsageBreakdown,
} from './usage-breakdown';
export { KNOWN_ROLE_ORDER, normalizeRole, getAgentUsageBreakdown } from './usage-breakdown';

export type {
  UtilizationDailyPoint,
  RoleUtilizationEntry,
  CliAgentUtilizationEntry,
  AgentUtilization,
} from './utilization';
export { unionLength, getAgentUtilization } from './utilization';

export type { ModelCostStats, CostOptimizationInsights } from './cost-optimization';
export { getCostOptimizationInsights } from './cost-optimization';

export type {
  ParetoFrontierResult,
  ParetoRecommendationResult,
  ParetoSegment,
  ParetoPoint,
  ParetoGoal,
  SegmentRecommendation,
  ParetoFrontierOptions,
} from './pareto-frontier';
export { getParetoFrontier, getParetoRecommendation } from './pareto-frontier';

export type {
  RepairTransitionRow,
  TaskFinalState,
  IterationBucket,
  RepairCauseBreakdown,
  RepairConvergenceStats,
} from './repair-convergence';
export { computeRepairConvergenceStats, getRepairConvergenceStats } from './repair-convergence';
