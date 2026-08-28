/**
 * Agent Utilization Query — barrel
 *
 * Re-exports the public API of the utilization module.
 */

export type {
  UtilizationDailyPoint,
  RoleUtilizationEntry,
  CliAgentUtilizationEntry,
  AgentUtilization,
} from './utilization-query';
export { unionLength, getAgentUtilization } from './utilization-query';
