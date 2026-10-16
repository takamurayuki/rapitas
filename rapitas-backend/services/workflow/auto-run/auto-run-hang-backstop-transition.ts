/**
 * auto-run-hang-backstop-transition
 *
 * Writes the WorkflowTransition row for a task the hang backstop blocked, and
 * owns the cause/metadata keys the reconciler reads back. It does NOT decide
 * whether the backstop fires (auto-run-active-decision) or how a blocked task
 * is recovered (blocked-unstarted-restore).
 */
import { recordTransition } from '../transition-recorder';

/** Transition cause written when the hang backstop force-blocks a task. */
export const HANG_BACKSTOP_CAUSE = 'auto_run_hang_backstop';

/** Metadata key: true when the task had no execution since it became current. */
export const NEVER_EXECUTED_SINCE_CURRENT_KEY = 'neverExecutedSinceCurrent';

/**
 * Record a real transition INTO blocked for a backstop force-stop.
 *
 * fromStatus is the task's prior state (workflowStatus, or task.status when the
 * workflow never started) so retro timelines attribute dwell time correctly; a
 * self-loop would show "nothing changed". Never throws.
 *
 * @param taskId - Blocked task / ブロックしたタスク
 * @param state - Pre-stop task state read before the blocked write / ブロック前のタスク状態
 * @param wallMinutes - Wall budget in minutes / 壁時間（分）
 * @param neverExecuted - No execution since the task became current / 現在期間に実行が無かったか
 */
export async function recordHangBackstopBlock(
  taskId: number,
  state: { status: string | null; workflowStatus: string | null } | null,
  wallMinutes: number,
  neverExecuted: boolean,
): Promise<void> {
  await recordTransition({
    taskId,
    fromStatus: state?.workflowStatus ?? state?.status ?? null,
    toStatus: 'blocked',
    actor: 'system',
    cause: HANG_BACKSTOP_CAUSE,
    metadata: {
      wallMinutes,
      workflowStatus: state?.workflowStatus ?? null,
      taskStatusFrom: state?.status ?? null,
      [NEVER_EXECUTED_SINCE_CURRENT_KEY]: neverExecuted,
    },
  }).catch(() => {});
}
