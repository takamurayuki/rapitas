/**
 * Phase Critic
 *
 * Judge-panel quality gate for the research/plan phases. Public API: run the
 * gate after an artifact is saved (applyPhaseCriticGate) and inject prior critic
 * feedback into the regenerating role's context (buildCriticFeedback).
 */
export { critiquePhase, isPhaseCriticEnabled, parseCriticResponse } from './phase-critic';
export {
  applyPhaseCriticGate,
  buildCriticFeedback,
  type PhaseCriticGateResult,
} from './phase-critic-gate';
export { aggregateCritiques, SEVERE_THRESHOLD } from './critique-aggregator';
export type { CriticPhase, CriticVerdict, PhaseCritiqueResult } from './phase-critic-types';
