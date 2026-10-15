/**
 * Repair Convergence Query — barrel
 *
 * Re-exports the public API of the self-repair convergence module.
 */

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
