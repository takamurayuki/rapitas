/**
 * self-improvement
 *
 * Barrel for the autonomous improvement-loop services: metrics over the
 * quality-loop event log, and the watcher that turns stagnation into
 * backlog concerns.
 */
export {
  computeLoopMetrics,
  classifyRepairReason,
  bucketTransitions,
  type LoopMetrics,
  type LoopMetricsWindow,
  type RepairCategory,
} from './loop-metrics';
export { runLoopReview, evaluateRules, type RuleFinding } from './loop-watcher';
export { runCiWatch, pickFailingWorkflows, type CiRun } from './ci-green-keeper';
