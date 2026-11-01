/**
 * Agent Metrics Overview Query — barrel
 *
 * Re-exports the public API of the overview/trends module: per-agent
 * metrics, execution trends, the overall metrics overview, and the
 * task-level first-pass completion rate shown beside it.
 */

export {
  buildDateWhereClause,
  getAgentMetrics,
  getExecutionTrends,
  getMetricsOverview,
  prisma,
} from './queries';

export {
  countFirstPassCompletions,
  getFirstPassCompletion,
  resolveRangeBounds,
  type FirstPassTransitionRow,
  type RangeBounds,
} from './first-pass-completion';
