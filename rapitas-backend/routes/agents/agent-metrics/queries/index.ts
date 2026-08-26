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
} from './queries';

export { getAgentPerformanceComparison } from './performance-query';

export type { DailyCostPoint, ModelMixEntry, SelfObservationSummary } from './observation-query';
export { getSelfObservationSummary } from './observation-query';

export type {
  RoleUsageEntry,
  DailyRoleCostPoint,
  CliAgentUsageEntry,
  AgentUsageBreakdown,
} from './usage-breakdown-query';
export { KNOWN_ROLE_ORDER, normalizeRole, getAgentUsageBreakdown } from './usage-breakdown-query';

export type {
  UtilizationDailyPoint,
  RoleUtilizationEntry,
  CliAgentUtilizationEntry,
  AgentUtilization,
} from './utilization-query';
export { unionLength, getAgentUtilization } from './utilization-query';

export type { ModelCostStats, CostOptimizationInsights } from './cost-optimization-query';
export { getCostOptimizationInsights } from './cost-optimization-query';

export type {
  RepairTransitionRow,
  TaskFinalState,
  IterationBucket,
  RepairCauseBreakdown,
  RepairConvergenceStats,
} from './repair-convergence-query';
export {
  computeRepairConvergenceStats,
  getRepairConvergenceStats,
} from './repair-convergence-query';

export type {
  NoChangeCompletionCause,
  NoChangeCompletionRow,
  RepairBounceRow,
  NoChangeCompletionBucket,
  NoChangeCompletionStats,
} from './no-change-completion-query';
export {
  computeNoChangeCompletionStats,
  getNoChangeCompletionStats,
} from './no-change-completion-query';
