/**
 * Role Model Outcomes — barrel
 *
 * Re-exports the public API of the role×model outcome aggregation.
 */

export type {
  ExecutionRow,
  TaskOutcome,
  RoleModelCell,
  CombinationCell,
} from './role-model-outcomes-scoring';
export {
  MIN_TASKS_FOR_RATE,
  summariseRoleModels,
  summariseCombinations,
} from './role-model-outcomes-scoring';
export type { RoleModelOutcomes } from './role-model-outcomes-query';
export { getRoleModelOutcomes } from './role-model-outcomes-query';
