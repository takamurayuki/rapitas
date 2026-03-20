/**
 * Workflow Agent Executor
 *
 * Barrel re-export that combines the CLI and API execution strategies.
 * Callers import from this path to avoid coupling to the internal split.
 */
export { executeCLIAgent } from './workflow-cli-executor';
export { executeAPIAgent } from './workflow-api-executor';
export type { RoleTransition, WorkflowAdvanceResult } from './workflow-types';
