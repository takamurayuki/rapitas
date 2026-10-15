/**
 * error-diagnosis
 *
 * Barrel for the LLM-assisted error diagnosis layer (task 612): mask, ask
 * the subscription CLI, record confidence/suggested-action, and aggregate
 * feedback. Behavior-neutral — never influences which fallback runs.
 */
export type {
  DiagnosisSuggestedAction,
  DiagnosisRecord,
  DiagnosisRecordInput,
  DiagnosisFeedbackRecord,
  DiagnosisFeedbackInput,
  DiagnosisSummary,
} from './error-diagnosis.types';
export { diagnoseErrorWithLlm, type DiagnoseErrorInput } from './diagnose-error';
export { recordDiagnosis, recordFeedback } from './error-diagnosis-recorder';
export {
  appendDiagnosis,
  readDiagnoses,
  appendFeedback,
  readFeedback,
  diagnosesFilePath,
  feedbackFilePath,
} from './error-diagnosis-store';
export { aggregate } from './error-diagnosis-aggregator';
