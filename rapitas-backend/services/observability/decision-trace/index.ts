/**
 * decision-trace barrel.
 *
 * Structured audit trail of critical decision points (AgentDecisionTrace).
 * Recording, DAG reconstruction, and async consistency checking.
 */
export { recordDecision } from './recorder';
export { getDecisionDag, type DecisionDag, type DecisionDagEdge } from './dag-query';
export {
  judgeConsistency,
  runConsistencyCheckBatch,
  type ConsistencyVerdict,
} from './consistency-checker';
export { maskSensitive, maskStringValue, type MaskResult } from './mask';
export type {
  DecisionKind,
  DecisionCandidate,
  RecordDecisionInput,
  ConsistencyState,
  AgentDecisionTraceRow,
} from './types';
