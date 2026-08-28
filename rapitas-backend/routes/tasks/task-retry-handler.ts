/**
 * TaskRetryHandler
 *
 * Returns a blocked/failed task to the queue in a state that can actually
 * RECORD the work its re-run produces.
 * Not responsible for dispatching the re-run itself.
 */
import { prisma } from '../../config/database';
import { ValidationError } from '../../middleware/error-handler';
import { resolveImplementEntryStatus } from '../../services/workflow/verify-self-repair';
import { recordTransition } from '../../services/workflow/transition-recorder';

/** Statuses a retry is allowed to act on. */
const RETRYABLE_STATUSES = new Set(['blocked', 'failed']);

/**
 * Roll the workflow back when it is parked somewhere nothing can be saved.
 *
 * Resetting `status` alone is not enough: ALLOWED_FILE_TYPES_BY_STATUS
 * .verify_done is an EMPTY set, so a task left there re-runs, works through a
 * full implementer phase, and is then refused when it PUTs verify.md ("file
 * type not allowed in current workflow status") — the run is discarded and the
 * task drifts straight back to where it started. Measured on task 632: a
 * 15.1 min / $4.15 implementer run whose result could never be recorded.
 *
 * @param taskId - Task being retried. / 再実行するタスク
 * @param workflowStatus - Its current workflowStatus. / 現在のworkflowStatus
 * @returns The status to roll back to, or null to leave it alone. / 巻き戻し先、無ければnull
 */
async function resolveRollbackTarget(
  taskId: number,
  workflowStatus: string | null,
): Promise<string | null> {
  if (workflowStatus !== 'verify_done') return null;
  // Same target the self-repair bounce uses — plan_approved when a plan exists,
  // else research_done. Both permit saving verify.
  return resolveImplementEntryStatus(taskId);
}

/**
 * Handle `POST /tasks/:id/retry`.
 *
 * @param id - Task id. / タスクID
 * @param setStatus - Setter for the HTTP status code. / HTTPステータス設定関数
 * @returns The updated task, or an error body when absent. / 更新後タスク、無ければエラー
 * @throws {ValidationError} When the task is not blocked/failed. / blocked/failed以外の場合
 */
export async function retryTask(id: number, setStatus: (code: number) => void): Promise<unknown> {
  const task = await prisma.task.findUnique({
    where: { id },
    select: { status: true, workflowStatus: true },
  });
  if (!task) {
    setStatus(404);
    return null;
  }
  if (!RETRYABLE_STATUSES.has(task.status)) {
    throw new ValidationError('blocked / failed のタスクのみ再実行できます');
  }

  const rolledBackTo = await resolveRollbackTarget(id, task.workflowStatus);
  const updated = await prisma.task.update({
    where: { id },
    data: { status: 'todo', ...(rolledBackTo ? { workflowStatus: rolledBackTo } : {}) },
  });

  // Always record the retry transition — a status revert with no matching
  // WorkflowTransition row leaves detectTriStateDesync's recovery-grace check
  // (isWithinRecoveryGrace, which only inspects the latest transition's cause)
  // blind to this reset, so the todo/workflowStatus mismatch gets flagged as
  // a fresh incident instead of being recognized as a known retry (task #602).
  // Before task 709 this call only fired for the verify_done rollback case, so
  // every other workflowStatus (research_done/plan_created/plan_approved/
  // in_progress/draft/null) left `status='todo'` reset with no transition
  // recorded, and the self-incident watcher's Pattern B fired on the shape
  // immediately — it is now recorded unconditionally, whether or not
  // rolledBackTo is set.
  //
  // NOTE (task #715): `status='todo'` while `workflowStatus` stays advanced is
  // NOT itself the defect — incident-signature-detectors.ts's own
  // RECOVERY_REQUEUE_CAUSES doc block establishes this as the intentional
  // resume shape shared with reconciler_requeue/artifact_reuse_fastforward
  // (task #672 self-healed to status=done/workflowStatus=completed via normal
  // dispatch with zero data repair — proof the shape converges on its own).
  // The defect this diff fixes is that the shape's causing transition was
  // never written, so `isWithinRecoveryGrace` had nothing to recognize and
  // treated a stale unrelated transition as "latest" forever. Writing this row
  // is what lets `detectTriStateDesync` correctly judge the state as
  // consistent-in-flight instead of contradictory — see the assertion against
  // `detectTriStateDesync` directly in task-routes.test.ts for the proof.
  //
  // This write does NOT touch the self-repair budget: countPriorRepairs
  // (verify-self-repair.ts / ci-self-repair.ts) and the reconciler's
  // "already retried" guards (workflow-reconciler-requeue.ts:164,
  // workflow-reconciler-blocked.ts:182) all key off `ActivityLog.action ===
  // 'task_retried'`, not `WorkflowTransition.cause` — that ActivityLog row
  // below is written unconditionally regardless of this change.
  await recordTransition({
    taskId: id,
    fromStatus: task.workflowStatus ?? 'draft',
    toStatus: rolledBackTo ?? task.workflowStatus ?? 'draft',
    actor: 'user',
    cause: 'task_retried',
    metadata: { from: task.status },
  }).catch(() => {});

  // countPriorRepairs resets the self-repair budget at the most recent
  // `task_retried` entry, so this row is what grants the retry a fresh slate.
  // Unconditional and unrelated to the WorkflowTransition write above (see NOTE).
  await prisma.activityLog
    .create({
      data: {
        taskId: id,
        action: 'task_retried',
        metadata: JSON.stringify({ from: task.status }),
        createdAt: new Date(),
      },
    })
    .catch(() => {});

  // Mark the skip notification read — notifyOnce dedups on an UNREAD
  // notification of the same task, so leaving it unread would suppress the
  // alert if this retry fails and the task is skipped again.
  await prisma.notification
    .updateMany({
      where: {
        type: 'auto_run_task_skipped',
        isRead: false,
        metadata: { contains: `"dedupKey":"auto_run_task_skipped:${id}"` },
      },
      data: { isRead: true, readAt: new Date() },
    })
    .catch(() => {});

  return updated;
}
