/**
 * queue-failure-mark-policy
 *
 * Decides which terminal WorkflowQueueItem rows count as a "failure mark" for
 * the supervisor false-failure signature, and which transition causes are
 * legitimate recoveries. Pure and DB-free. NOT responsible for writing queue
 * status — the writers listed below own their messages.
 */
import { RECOVERY_REQUEUE_CAUSES } from './incident-signature-detectors';
import { isTaskVanishedMessage } from './queue-vanished-task-policy';

/**
 * errorMessage fragments written by the benign `cancelled` writers: reconciler
 * sweeps, halt parking, vanished-task cancels, user stop/reset. None of them
 * records a failed run, so a later success is not a wrong verdict.
 * NOTE: keep in sync with the writers — queue-dequeue-candidate.ts,
 * workflow-reconciler-queue-sweep.ts, workflow-reconciler-queue-stall.ts,
 * workflow-runner-halt-guard.ts, queue-vanished-task-policy.ts,
 * auto-run-stall-guard.ts, auto-run-lifecycle.ts, stop-route.ts, reset-route.ts,
 * orchestra.ts. A message that drifts only turns into a conservative "failure".
 */
const BENIGN_CANCEL_MESSAGE_FRAGMENTS: readonly string[] = [
  '残留キュー項目を自動キャンセル',
  'キュー枠を占有していた残留項目を自動キャンセル',
  '実行しえない状態のまま running が残っていた',
  '生存実行が確認できないため自動キャンセル',
  'is halted (',
  'Repair admission expired or was stopped before dispatch',
  'Auto-run stopped',
  'Cancelled by user',
  'Reset by user',
  'Re-run by user',
];

/**
 * Transition causes that mean the system re-queued the task on purpose — the same
 * set incident-signature-detectors uses, so both detectors agree on "recovery".
 */
export const FAILURE_RECOVERY_CAUSES: ReadonlySet<string> = RECOVERY_REQUEUE_CAUSES;

/**
 * Whether a queue item should be counted as a terminal failure mark.
 * `failed` always counts. `cancelled` counts unless its errorMessage matches a
 * known benign writer; unknown or empty messages count (missing a real false
 * failure costs more than one extra report).
 *
 * @param status - WorkflowQueueItem.status. / キュー項目の状態
 * @param errorMessage - WorkflowQueueItem.errorMessage. / エラーメッセージ
 * @returns true when the row is a failure mark. / 失敗マークなら true
 */
export function isFailureMarkQueueItem(status: string, errorMessage: string | null): boolean {
  if (status === 'failed') return true;
  if (status !== 'cancelled') return false;
  if (!errorMessage) return true;
  if (isTaskVanishedMessage(errorMessage)) return false;
  return !BENIGN_CANCEL_MESSAGE_FRAGMENTS.some((f) => errorMessage.includes(f));
}
