/**
 * queue-terminal-task-guard
 *
 * Shared terminal-state predicate for stale queue items. Extracted from
 * workflow-queue.ts (file-size split, and to break a workflow-queue.ts ↔
 * queue-dequeue-candidate.ts import cycle) — re-exported from workflow-queue.ts
 * for backward compatibility with existing external importers.
 */

/**
 * Whether a task has reached a terminal state that makes any queued work for it
 * stale. Shared by the dequeue-time guard and the reconciler's periodic sweep
 * so the two can never drift apart on what "terminal" means (concern #4924).
 * Requires POSITIVE terminal evidence — a null lookup can also be a transient
 * DB error and must not read as terminal.
 *
 * @param task - Minimal task state (or null when lookup failed). / タスク状態
 * @returns true when the task is done/cancelled/completed. / 終端なら true
 */
export function isTaskTerminalForQueue(
  task: { status?: string | null; workflowStatus?: string | null } | null,
): boolean {
  if (!task) return false;
  return (
    task.status === 'done' || task.status === 'cancelled' || task.workflowStatus === 'completed'
  );
}

/**
 * Whether a task's halt is still in force, as opposed to left over from before
 * it finished. Nothing clears haltReason on completion — haltIfIterationBudget
 * Exceeded writes it and only halt-release.ts clears it — so a finished task
 * keeps carrying its last halt forever. Measured 2026-10-06: 4 of the 6 tasks
 * holding a haltReason were status=done (#1031/#1060/#1110/#1112).
 *
 * Reading that stale value as "halted" is wrong in the permissive direction for
 * the overlap guard: it drops the finished task's still-open PR from the
 * candidate set, so the hold never applies and two implementers edit the same
 * files. A finished task's PR is precisely the one worth waiting for.
 *
 * @param task - Halt column plus the status pair (or null when lookup failed). / タスク状態
 * @returns true only when a non-terminal task is halted. / 終端でなく halt 中なら true
 */
export function isTaskHaltActive(
  task: {
    haltReason?: string | null;
    status?: string | null;
    workflowStatus?: string | null;
  } | null,
): boolean {
  if (task?.haltReason == null) return false;
  return !isTaskTerminalForQueue(task);
}
