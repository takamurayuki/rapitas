/**
 * decision-ledger
 *
 * Read-only view over every judgement the system makes that can later be shown
 * right or wrong. Three tables store them; this is the one place that reads
 * them, so accuracy means the same thing wherever it is quoted.
 */

export type {
  Decision,
  DecisionFilter,
  DecisionKind,
  DecisionVerdict,
  VerdictSummary,
} from './types';
export { readDecisions } from './query';
export { tierOutcomesForRole, type TierOutcome } from './tier-outcomes';
export {
  knowledgeUsefulness,
  MIN_OBSERVATIONS,
  type EntryUsefulness,
} from './knowledge-usefulness';
export { settleDecisions, type SettlementResult } from './settle';
export { recordFilingDecision, type FilingDecision } from './record-filing';
export { recordRecallDecision, type RecallDecision } from './record-recall';
export { judgeRecall } from './settle-knowledge';
export { summarizeVerdicts, summarizeBy, groupDecisions, totalCostUsd } from './aggregate';
export { fromDecisionTrace } from './from-decision-trace';
export { kindFromNodeKey } from '../observability/decision-trace/node-key';
export { fromLearningRecord, judgeLearningRecord, DURATION_BAND } from './from-learning-record';
export { fromDecisionLog } from './from-decision-log';
