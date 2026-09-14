/**
 * Supervision services barrel
 *
 * Public API of the supervision acceptance gate (task 904).
 */
export * from './supervision-events';
export {
  GATE_MUTATION_PATHS,
  isGateMutationPath,
  readLastGateMutation,
  selectGateMutationPaths,
} from './gate-mutation-paths';
export {
  classifyTransition,
  flushPendingInterventions,
  getInterventionWriteHealth,
  hasInterventionWriteFailure,
  listInterventions,
  recordCompletionGateViolation,
  recordIntervention,
  syncInterventionsFromTransitions,
} from './intervention-detector';
export {
  detectAndRecordGap,
  findSilences,
  listObservationGaps,
  readRecentHeartbeats,
  sumGapMsWithin,
} from './observation-gap-detector';
export { calculateStreak, REQUIRED_STREAK_HOURS, REQUIRED_STREAK_TASKS } from './streak-calculator';
export {
  assessKnowledgeReuseEvidence,
  readLatestKnowledgeReuseEval,
  recordKnowledgeReuseEval,
} from './knowledge-reuse-comparison';
export {
  evaluateAcceptance,
  readAcceptanceStatus,
  refreshAcceptanceSnapshot,
} from './acceptance-status-service';
export {
  emitHeartbeat,
  getSupervisionHeartbeatScheduler,
  startSupervisionHeartbeatScheduler,
  stopSupervisionHeartbeatScheduler,
} from './supervision-heartbeat-scheduler';
