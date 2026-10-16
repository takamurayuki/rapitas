/**
 * task-iteration-budget-success
 *
 * Pure helpers that keep a task which just reached PR-created / awaiting-merge
 * from being judged "no progress" by the iteration budget (task 1018, #1009).
 * It does not decide halts itself; it only trims the transition list fed to
 * the repeat-cause and status-repeat signals.
 */

/**
 * Transition causes recorded when verification passed and the task is waiting
 * on CI / the required merge. Reaching them is progress, not repetition.
 * NOTE: `pr_created` is a notification type, not a WorkflowTransition cause.
 */
const SUCCESS_SIDE_CAUSES = new Set([
  'verify_passed_awaiting_ci',
  'verify_awaiting_required_merge',
]);

/**
 * Whether a transition cause marks a successful hand-off to CI / merge.
 *
 * @param cause - WorkflowTransition.cause value. / 遷移の原因
 * @returns True for success-side causes. / 成功側の原因なら true
 */
export function isSuccessSideTransitionCause(cause: string | null | undefined): boolean {
  return cause != null && SUCCESS_SIDE_CAUSES.has(cause);
}

/**
 * Keep only the transitions after the last success-side one, so repair bounces
 * that preceded the success no longer count toward repeat detection.
 *
 * @param transitions - Transitions in ascending time order. / 時系列昇順の遷移
 * @returns Transitions after the last success (input unchanged if none). / 最後の成功以降の遷移
 */
export function sliceAfterLastSuccess<T extends { cause: string | null }>(transitions: T[]): T[] {
  for (let i = transitions.length - 1; i >= 0; i--) {
    if (isSuccessSideTransitionCause(transitions[i].cause)) return transitions.slice(i + 1);
  }
  return transitions;
}

/**
 * Whether the task is a verify_done task with a linked PR whose latest work
 * transition still landed on verify_done (the completion point is the merge).
 *
 * @param args - Task state snapshot. / タスク状態
 * @returns True when the task is merely awaiting merge. / マージ待ちのみなら true
 */
export function isAwaitingMergeWithPr(args: {
  workflowStatus: string | null | undefined;
  githubPrId: number | null | undefined;
  lastToStatus: string | null | undefined;
}): boolean {
  return (
    args.workflowStatus === 'verify_done' &&
    args.githubPrId != null &&
    args.lastToStatus === 'verify_done'
  );
}
