/**
 * FileSave Pipeline Barrel
 *
 * Re-exports the workflow file-save pipeline stages for the orchestrating
 * handler (workflow-handlers-files.ts) — FOLDER_ORGANIZATION_POLICY §4.
 */

export { markLatestExecutionFailed, ALLOWED_FILE_TYPES_BY_STATUS } from './shared';
export {
  validateFileType,
  resolveTargetTask,
  guardStatusTransition,
  guardParentSubtasksTerminal,
  type ResolvedWorkflowTask,
  type GuardStatusTransitionOutcome,
} from './guards';
export { prepareAndPersistContent, type ContentPrepOutcome } from './content-prep';
export { computeAndApplyStatusTransition, type StatusTransitionOutcome } from './status-transition';
export { runPhaseCriticGate, type CriticGateOutcome } from './critic-gate';
export { runPlanPostProcessing, type PlanPostProcessingOutcome } from './plan-post-processing';
export {
  runVerifyCompletionGate,
  type VerifyCompletionGateOutcome,
} from './verify-completion-gate';
export {
  runAdversarialDiffReview,
  type AdversarialReviewOutcome,
} from './verify-adversarial-review';
export { runVerifyCommitPrCompletion, type CommitPrCompletionOutcome } from './verify-commit-pr';
export { runVerifyPostSaveAutomation } from './verify-post-save-pipeline';
