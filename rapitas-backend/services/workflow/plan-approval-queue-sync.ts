/**
 * plan-approval-queue-sync
 *
 * Moves a task's `waiting_approval` queue items forward once its plan is
 * approved, and tells the theme auto-run scheduler so a `paused_approval`
 * theme resumes. It does NOT decide whether a plan may be approved — the
 * approval gates (forbidden-change hold, manual hold) stay with their owners.
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { prisma as defaultPrisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const log = createLogger('workflow:plan-approval-queue-sync');

/** Task workflow statuses that mean the plan has been approved. */
const PLAN_APPROVED_STATUSES = ['plan_approved', 'in_progress', 'verify_done', 'completed'];

/** Execution statuses that mean an agent is still working on the task. */
const IN_FLIGHT_EXECUTION_STATUSES = ['running', 'pending', 'waiting_for_input'];

/** Minimal Prisma surface used here; lets callers pass their own client. */
type SyncClient = Pick<PrismaClient, 'task' | 'workflowQueueItem' | 'agentExecution'>;

/** Outcome of {@link syncQueueAfterPlanApproval}. */
export interface PlanApprovalQueueSyncResult {
  released: number;
  skipped?: 'not_approved' | 'no_item' | 'in_flight' | 'error';
}

/**
 * Whether a task workflowStatus is at or past plan approval.
 *
 * @param workflowStatus - Task.workflowStatus / タスクのワークフロー状態
 * @returns true once the plan is approved / 承認済みなら true
 */
export function isPlanApprovedStatus(workflowStatus: string | null | undefined): boolean {
  return !!workflowStatus && PLAN_APPROVED_STATUSES.includes(workflowStatus);
}

/**
 * Read whether a task's plan is approved; fails closed (false) on DB errors.
 *
 * @param taskId - Task to check / 対象タスク
 * @param client - Prisma client override / Prismaクライアント
 * @returns true when the task is plan-approved / 承認済みなら true
 */
export async function isTaskPlanApproved(
  taskId: number,
  client: SyncClient = defaultPrisma,
): Promise<boolean> {
  try {
    const task = await client.task.findUnique({
      where: { id: taskId },
      select: { workflowStatus: true },
    });
    return isPlanApprovedStatus(task?.workflowStatus);
  } catch (err) {
    log.warn({ err, taskId }, '[plan-approval-queue-sync] task status read failed');
    return false;
  }
}

/**
 * Release a plan-approved task's `waiting_approval` queue items back to `queued`.
 *
 * Never touches items while an agent execution for the task is in flight (a
 * requeue would let the dispatcher start a second agent on the same worktree),
 * and never throws: approval is already committed, so a failure here is left
 * for the paused-theme safety net.
 *
 * @param taskId - Task whose plan was approved / 承認されたタスク
 * @param client - Prisma client override / Prismaクライアント
 * @returns Count released and why nothing was, if so / 解放件数とスキップ理由
 */
export async function syncQueueAfterPlanApproval(
  taskId: number,
  client: SyncClient = defaultPrisma,
): Promise<PlanApprovalQueueSyncResult> {
  try {
    if (!(await isTaskPlanApproved(taskId, client))) {
      return { released: 0, skipped: 'not_approved' };
    }
    const items = await client.workflowQueueItem.findMany({
      where: { taskId, status: 'waiting_approval' },
      select: { id: true },
    });
    if (items.length === 0) return { released: 0, skipped: 'no_item' };

    const inFlight = await client.agentExecution.findMany({
      where: { status: { in: IN_FLIGHT_EXECUTION_STATUSES }, session: { config: { taskId } } },
      select: { id: true },
    });
    if (inFlight.length > 0) return { released: 0, skipped: 'in_flight' };

    // CAS on status so a concurrent resumeAfterApproval is not double-written.
    const updated = await client.workflowQueueItem.updateMany({
      where: { taskId, status: 'waiting_approval' },
      data: { status: 'queued', currentPhase: 'plan_approved' },
    });
    return { released: updated.count };
  } catch (err) {
    log.warn({ err, taskId }, '[plan-approval-queue-sync] queue release failed (non-fatal)');
    return { released: 0, skipped: 'error' };
  }
}

/**
 * Release the task's queue items, then let the theme scheduler resume.
 * Shared by the auto-approve and manual-approve paths.
 *
 * @param taskId - Task whose plan was approved / 承認されたタスク
 * @returns Release outcome / 解放結果
 */
export async function syncAfterPlanApprovalAndNotifyTheme(
  taskId: number,
): Promise<PlanApprovalQueueSyncResult> {
  const result = await syncQueueAfterPlanApproval(taskId);
  try {
    const { ThemeAutoRunScheduler } = await import('./auto-run/theme-auto-run-scheduler');
    await ThemeAutoRunScheduler.getInstance().onPlanApproved(taskId);
  } catch (err) {
    log.warn({ err, taskId }, '[plan-approval-queue-sync] theme resume notification failed');
  }
  return result;
}
