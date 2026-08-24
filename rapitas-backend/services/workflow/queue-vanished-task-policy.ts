/**
 * queue-vanished-task-policy
 *
 * Shared marker for "this queue item was cancelled because its task row is
 * confirmed absent" (deleted, or never persisted past enqueue). dequeue-time
 * dispatch, the in-flight runner loop, and the periodic reconciler sweep each
 * write this same marker so a single downstream check (auto-run's advance
 * step) can recognize a vanished task regardless of which of the three
 * detected it first.
 *
 * Pure predicate — no I/O.
 */

const VANISHED_TASK_PREFIX = 'タスク行が見つからないため、残留キュー項目を自動キャンセルしました';

/**
 * Build the errorMessage recorded on a queue item cancelled because its task
 * is confirmed absent.
 *
 * @param taskId - The vanished task's id. / 消失したタスクのID
 * @returns Fixed-prefix message embedding the task id. / 固定接頭辞付きメッセージ
 */
export function taskVanishedMessage(taskId: number): string {
  return `${VANISHED_TASK_PREFIX}（タスク ${taskId}）`;
}

/**
 * Whether a queue item's errorMessage marks it as cancelled for a confirmed-
 * absent task, as opposed to any other cancellation/failure reason.
 *
 * @param message - The queue item's errorMessage, if any. / キュー項目のエラーメッセージ
 * @returns true when the message was produced by taskVanishedMessage. / 消失マーカーなら true
 */
export function isTaskVanishedMessage(message?: string | null): boolean {
  return !!message && message.startsWith(VANISHED_TASK_PREFIX);
}
