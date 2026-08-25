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
export { summarizeVerdicts, summarizeBy, groupDecisions, totalCostUsd } from './aggregate';
export { fromDecisionTrace, kindFromNodeKey } from './from-decision-trace';
export { fromLearningRecord, judgeLearningRecord, DURATION_BAND } from './from-learning-record';
export { fromDecisionLog } from './from-decision-log';
