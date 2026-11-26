/**
 * services/goals
 *
 * Goals (projects seen from the person's side), their milestones (節目) and
 * the confirmation that a milestone was reached.
 */
export {
  MILESTONE_STATUSES,
  checkConfirmation,
  goalProgress,
  reachRateWithDue,
  toRateCount,
  parseMilestoneCriteria,
  type ConfirmationRefusal,
  type GoalProgress,
  type RateCount,
  type MilestoneStatus,
} from './milestone-achievement';
export {
  MILESTONE_ORDER,
  toGoalDetail,
  toGoalSummary,
  toMilestoneView,
  type GoalDetail,
  type GoalSummary,
  type MilestoneView,
} from './goal-views';
export { MILESTONE_REOPENED_EVENT, milestoneReopenedEvent } from './milestone-reopen-log';
export {
  INSIGHT_PERIODS,
  STALL_DAYS,
  buildReachedLedger,
  computeInsights,
  goalRow,
  isStalled,
  qualityMetric,
  resumeMetric,
  type GoalRow,
  type InsightGoal,
  type InsightMetric,
  type InsightMetrics,
  type InsightPeriod,
  type InsightsResult,
  type ReopenRecord,
} from './goal-insights';
