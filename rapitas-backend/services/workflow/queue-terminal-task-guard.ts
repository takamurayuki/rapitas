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
