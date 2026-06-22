/**
 * Intake
 *
 * Public API of the intake quality gate: enrich a thin task spec before the
 * research phase and, per policy, pause once for clarification or proceed on
 * best-guess. Wire-in point: WorkflowOrchestrator's draft → research advance.
 */
export { ensureIntakeReady, type IntakeOutcome } from './intake-gate';
export {
  checkSpecQuality,
  parseSpecArray,
  mergeSpecField,
  specFieldLabel,
  MIN_DESCRIPTION_LENGTH,
  ADEQUATE_SCORE,
  type SpecField,
  type SpecQualityInput,
  type SpecQualityResult,
} from './spec-quality-checker';
export {
  resolveIntakePolicy,
  decideIntake,
  type IntakePolicy,
  type IntakeAction,
  type ResolvedIntakePolicy,
} from './intake-policy';
export { buildIntakeQuestion, type IntakeQuestionInput } from './intake-question-template';
