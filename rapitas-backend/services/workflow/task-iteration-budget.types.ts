/**
 * task-iteration-budget.types
 *
 * Type definitions for the task-wide iteration halt budget (task 881): the
 * HaltReason vocabulary, the halt state returned by resolveIterationBudgetState,
 * and the resumeCondition JSON shape persisted on Task.resumeCondition.
 */

/**
 * Reason an automatic iteration budget halted a task. Fixed to exactly these
 * five values — schedulers/UI branch on this vocabulary, so nothing else may
 * be written to Task.haltReason. Priority order when multiple axes exceed
 * simultaneously: time > cost > attempts > repeat_cause > no_progress (first
 * match wins, see resolveIterationBudgetState).
 */
export type HaltReason =
  | 'budget_time_exceeded'
  | 'budget_cost_exceeded'
  | 'budget_attempts_exceeded'
  | 'repeat_cause_detected'
  | 'no_progress';

/**
 * Structured re-entry condition persisted as JSON on Task.resumeCondition.
 * requiresNewHypothesis signals that blind auto-retry must not resume this
 * task until a human (or a differently-reasoned agent pass) supplies a new
 * approach — mirrors the task's own "新しい仮説が必要" framing.
 */
export interface ResumeCondition {
  requiresNewHypothesis: boolean;
  note: string;
}

/** Result of evaluating a task's combined iteration budget. */
export interface IterationBudgetState {
  shouldHalt: boolean;
  haltReason?: HaltReason;
  resumeCondition?: ResumeCondition;
}
