/**
 * task-iteration-budget-status
 *
 * Pure counting of non-advancing workflowStatus transitions (no-progress
 * condition ①) for task-iteration-budget. Not responsible for DB access or
 * the halt decision itself.
 */

import { WF_STATUS_RANK } from './workflow-cli-executor-helpers';

/**
 * Causes written when the system deliberately re-runs a task from an earlier
 * status (stale-terminal reset, blocked auto-retry, manual retry, reconciler
 * requeue). They are rewinds by design, not evidence of a stuck loop, so they
 * must not feed the no-progress signal (task 994: 984/986 were halted right
 * after verify_done because each re-run passed the same statuses again).
 */
const RESET_TRANSITION_CAUSES = new Set([
  'stale_terminal_reset',
  'blocked_auto_retry',
  'task_retried',
  'reconciler_requeue',
  'reconciler_reset_undispatchable',
]);

/**
 * Whether a transition cause is an intentional reset/re-run.
 *
 * @param cause - WorkflowTransition.cause value. / 遷移の原因
 * @returns True for reset-family causes. / reset 系の原因なら true
 */
export function isResetTransitionCause(cause: string | null | undefined): boolean {
  return cause != null && RESET_TRANSITION_CAUSES.has(cause);
}

/** Minimal transition shape needed by {@link countNonAdvancingTransitions}. */
export interface StatusTransitionSample {
  fromStatus: string | null;
  toStatus: string;
  cause: string | null;
}

/**
 * Count transitions that did not move the workflow forward (same status
 * re-recorded, or a step back), ignoring reset-family and halt-side causes.
 * A task progressing through draft→…→verify_done yields 0 no matter how many
 * re-runs happened; a verify↔implement bounce yields one per step back.
 *
 * @param transitions - Transitions in the window. / 窓内の遷移
 * @param isExcludedCause - Extra cause filter (halt side). / 追加の除外条件
 * @returns Non-advancing count; unknown/null statuses are not counted. / 前進しなかった遷移数
 */
export function countNonAdvancingTransitions(
  transitions: StatusTransitionSample[],
  isExcludedCause: (cause: string | null) => boolean = () => false,
): number {
  let count = 0;
  for (const t of transitions) {
    if (isResetTransitionCause(t.cause) || isExcludedCause(t.cause)) continue;
    if (t.fromStatus == null) continue;
    const from = WF_STATUS_RANK[t.fromStatus];
    const to = WF_STATUS_RANK[t.toStatus];
    if (from === undefined || to === undefined) continue;
    if (to <= from) count++;
  }
  return count;
}
