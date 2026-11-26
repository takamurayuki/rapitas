/**
 * companion-approval-hold
 *
 * Reports a per-task plan-approval wait while other tasks of the theme keep
 * running (task 1552). The theme-wide pause notifies once because the theme
 * stops ticking that task; a per-task hold is re-evaluated every tick, so this
 * remembers which waits were already reported. Not responsible for approving.
 */
import { logCycleEvent } from '../../../observability';
// Namespace import: tests mock auto-run-notifications with a subset of exports.
import * as notifications from '../auto-run-notifications';
import { broadcastAutoRunUpdateImpl } from '../auto-run-lifecycle';

/** Waits already reported, process-local (a restart re-reports once). */
const reported = new Set<number>();
const MAX_REMEMBERED = 500;

/**
 * Notify once that a task waits for plan approval while its theme keeps running.
 *
 * @param themeId - Theme / テーマID
 * @param taskId - Task waiting for approval / 承認待ちのタスク
 */
export async function notifyCompanionAwaitingApprovalOnce(
  themeId: number,
  taskId: number,
): Promise<void> {
  if (reported.has(taskId)) return;
  if (reported.size >= MAX_REMEMBERED) reported.clear();
  reported.add(taskId);
  if (typeof notifications.notifyAwaitingPlanApproval === 'function') {
    await notifications.notifyAwaitingPlanApproval(themeId, taskId);
  }
  broadcastAutoRunUpdateImpl(themeId);
  logCycleEvent('task.awaiting_approval', {
    theme: themeId,
    task: taskId,
    cause: 'plan_approval_gate',
    parallel: true,
    msg: 'task holds for plan approval — the theme keeps running its other tasks',
  });
}

/** Forget reported waits (tests only). */
export function __resetCompanionApprovalHoldsForTests(): void {
  reported.clear();
}
