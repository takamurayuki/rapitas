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
  parseMilestoneCriteria,
  type ConfirmationRefusal,
  type GoalProgress,
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
