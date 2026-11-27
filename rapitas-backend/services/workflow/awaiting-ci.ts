/**
 * awaiting-ci
 *
 * Pure predicates for the "CI wait" shape (task 1568): the task is parked at
 * `verify_done` / `in-progress` for its required merge and its queue item was
 * handed back with `currentPhase = 'awaiting_ci'`, so the theme's slot is free.
 * Not responsible for writing either side — see required-merge-hold.ts and
 * workflow-runner-verify-settle.ts.
 */

/**
 * `currentPhase` of a RUNNING queue item whose task waits for CI / the required merge. Written by
 * holdForRequiredMerge in the same transaction as the hold; the scheduler's hand-back only
 * completes items in this phase, and a runner that wants to act on its item first moves it out of
 * this phase (workflow-runner-item-claim.ts), so the two can never both win.
 */
export const CI_WAIT_PHASE = 'ci_wait';

/**
 * `currentPhase` of a RUNNING queue item while its runner is advancing a phase (task 1568). The
 * claim writes it; while it stands the item is the runner's: holdForRequiredMerge does not move it
 * to the CI-wait phase and the scheduler's hand-back finds no CI-wait item to complete. The runner
 * itself moves the item to the CI-wait phase when its advance ends with the task parked for CI.
 */
export const ADVANCING_PHASE = 'advancing';

/** `currentPhase` of a queue item handed back while its task waits for CI / the required merge. */
export const AWAITING_CI_PHASE = 'awaiting_ci';

/**
 * Whether a queue item is one handed back for a CI wait.
 *
 * @param item - Queue item (or null). / キュー項目
 * @returns True when its phase is `awaiting_ci`. / awaiting_ci の項目なら true
 */
export function isAwaitingCiItem(
  item: { currentPhase?: string | null } | null | undefined,
): boolean {
  return item?.currentPhase === AWAITING_CI_PHASE;
}

/**
 * Whether a task is in the held shape that AutoMergeWatcher owns (the same shape
 * auto-merge-candidates.ts's `isAwaitingCi` looks for).
 *
 * @param task - Task state (or null). / タスク状態
 * @returns True for `in-progress` + `verify_done`. / 保留形なら true
 */
export function isCiWaitTask(
  task: { status: string; workflowStatus?: string | null } | null | undefined,
): boolean {
  return task?.status === 'in-progress' && task.workflowStatus === 'verify_done';
}
