/**
 * orphan-flag-policy
 *
 * Decides whether an in-progress task with no live execution should be
 * SURFACED to the operator as stalled. Pure: the caller performs the lookups
 * and owns the notification itself.
 */

/**
 * Whether to tell the operator this task looks stalled.
 *
 * `completed` is healed elsewhere, `awaiting_question` is paused on purpose, and
 * a task at `verify_done` can be legitimately awaiting the auto-merge watcher —
 * whose window (90 min) outlasts the staleness cutoff (45 min). Advising a
 * re-run there would discard a publication that is mid-flight: observed
 * 2026-09-27 on task 1106, whose PR merged 25 minutes after the notification
 * fired. The sibling requeue pass already guarded on this; the notifier did not.
 *
 * @param workflowStatus - The task's workflow status. / ワークフロー状態
 * @param awaitingRequiredMerge - Whether it is waiting on a required merge.
 *   Callers must pass `true` when the lookup fails — an unreadable policy must
 *   never read as "not awaiting a merge". / 必須マージ待ちか（判定不能時は true）
 * @returns true when the operator should be notified. / 通知すべきなら true
 */
export function shouldFlagOrphanTask(
  workflowStatus: string | null,
  awaitingRequiredMerge: boolean,
): boolean {
  if (workflowStatus === 'completed' || workflowStatus === 'awaiting_question') return false;
  if (workflowStatus === 'verify_done' && awaitingRequiredMerge) return false;
  return true;
}
