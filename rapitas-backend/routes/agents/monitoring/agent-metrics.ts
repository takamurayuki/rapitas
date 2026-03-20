/**
 * Agent Metrics Route
 *
 * Re-exports all public symbols from the agent-metrics sub-modules.
 * Maintained for backward compatibility — consumers should prefer importing
 * from the sub-modules directly for tree-shaking benefits.
 */

export type {
  AgentMetrics,
  ExecutionTrendData,
  AgentPerformanceComparison,
  MetricsOverview,
  DateRange,
} from '../agent-metrics/types';

export {
  getAgentMetrics,
  getExecutionTrends,
  getMetricsOverview,
  buildDateWhereClause,
} from '../agent-metrics/queries';

export { getAgentPerformanceComparison } from '../agent-metrics/performance-query';

export { agentMetricsRouter } from '../agent-metrics/router';
