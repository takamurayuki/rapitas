/**
 * manual-status-queue-sync
 *
 * Brings the workflow queue in line after a human changed a task's workflow
 * status, so auto-run continues from the new status. It does NOT decide who may
 * change a status, and never stops a running agent.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import type { WorkflowStatus } from '../workflow-types';
import { WorkflowQueueService } from '../workflow-queue';
import { isTaskTerminalForQueue } from '../queue-terminal-task-guard';
import { readAutoRunHold } from '../auto-run/auto-run-hold-check';
import { readThemeActiveSet, activeTaskIds } from '../auto-run/parallel/theme-active-set';
import { getAutoRunState } from '../auto-run/theme-auto-run-queries';
import { isPausedAutoRunStatus } from '../auto-run/theme-auto-run-types';

const log = createLogger('workflow:manual-status-queue-sync');

/** Statuses a person may meaningfully rewind to; others leave the queue alone. */
const SYNCED_STATUSES: ReadonlySet<WorkflowStatus> = new Set<WorkflowStatus>([
  'draft',
  'research_done',
  'plan_created',
  'plan_approved',
  'in_progress',
  'verify_done',
]);

/** Execution statuses that mean an agent is still working on the task. */
const IN_FLIGHT_EXECUTION_STATUSES = ['running', 'pending', 'waiting_for_input'];

/** What the sync did, or why it did nothing. */
export type ManualStatusQueueSyncOutcome =
  | 'terminal'
  | 'in_flight'
  | 'held'
  | 'running'
  | 'updated'
  | 'released'
  | 'unchanged'
  | 'enqueued'
  | 'not_current'
  | 'error';

async function applySync(
  taskId: number,
  status: WorkflowStatus,
): Promise<ManualStatusQueueSyncOutcome> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, workflowStatus: true, themeId: true },
  });
  if (!task || isTaskTerminalForQueue(task)) return 'terminal';

  const inFlight = await prisma.agentExecution.findMany({
    where: { status: { in: IN_FLIGHT_EXECUTION_STATUSES }, session: { config: { taskId } } },
    select: { id: true },
  });
  if (inFlight.length > 0) return 'in_flight';

  // Preflight refuses a blocked task, and healBlockedStatusDesync skips draft /
  // research_done, so a rewind would otherwise never run.
  if (task.status === 'blocked' || task.status === 'failed') {
    await prisma.task.updateMany({
      where: { id: taskId, status: task.status },
      data: { status: 'todo' },
    });
  }

  if ((await readAutoRunHold(prisma, taskId)).held) return 'held';

  const items = await prisma.workflowQueueItem.findMany({
    where: { taskId, status: { in: ['queued', 'running', 'waiting_approval'] } },
    select: { id: true, status: true },
  });
  // The runner re-reads Task.workflowStatus when the running phase ends.
  if (items.some((i) => i.status === 'running')) return 'running';

  const queued = items.filter((i) => i.status === 'queued').map((i) => i.id);
  if (queued.length > 0) {
    const { count } = await prisma.workflowQueueItem.updateMany({
      where: { id: { in: queued }, status: 'queued' },
      data: { currentPhase: status },
    });
    return count > 0 ? 'updated' : 'unchanged';
  }

  const waiting = items.filter((i) => i.status === 'waiting_approval').map((i) => i.id);
  if (waiting.length > 0) {
    if (status === 'plan_created') return 'unchanged';
    const { count } = await prisma.workflowQueueItem.updateMany({
      where: { id: { in: waiting }, status: 'waiting_approval' },
      data: { status: 'queued', currentPhase: status },
    });
    return count > 0 ? 'released' : 'unchanged';
  }

  // No active item: only a task the theme still holds needs one rebuilt here —
  // the scheduler would read its old 'completed' item and release the slot.
  const themeId = task.themeId;
  if (!themeId) return 'not_current';
  if (!activeTaskIds(await readThemeActiveSet(prisma, themeId)).includes(taskId)) {
    return 'not_current';
  }
  const theme = await getAutoRunState(themeId);
  if (!theme || !(theme.status === 'running' || isPausedAutoRunStatus(theme.status))) {
    return 'not_current';
  }
  try {
    await WorkflowQueueService.getInstance().enqueue({ taskId, themeId, priority: 50 });
  } catch (err) {
    if (err instanceof Error && err.message.includes('already in the queue')) return 'unchanged';
    throw err;
  }
  return 'enqueued';
}

/**
 * Re-sync the queue after a manual status change. Never throws: the status is
 * already saved, and repeating the same change retries the sync.
 *
 * @param taskId - Task whose status was changed / 状態を変えたタスク
 * @param status - The new workflow status / 変更後の状態
 * @returns What was done, `error` on failure / 実施内容（失敗は error）
 */
export async function syncQueueAfterManualStatusChange(
  taskId: number,
  status: WorkflowStatus,
): Promise<{ outcome: ManualStatusQueueSyncOutcome }> {
  if (!SYNCED_STATUSES.has(status)) return { outcome: 'unchanged' };

  let outcome: ManualStatusQueueSyncOutcome;
  try {
    outcome = await applySync(taskId, status);
  } catch (err) {
    log.warn({ err, taskId, status }, '[manual-status] queue sync failed (non-fatal)');
    return { outcome: 'error' };
  }

  const advanced = outcome === 'updated' || outcome === 'released' || outcome === 'enqueued';
  if (advanced && status !== 'plan_created') {
    try {
      // NOTE: named for plan approval, but it only resumes a `paused_approval`
      // theme whose currentTaskId is this task — which is what is needed here.
      const { ThemeAutoRunScheduler } = await import('../auto-run/theme-auto-run-scheduler');
      await ThemeAutoRunScheduler.getInstance().onPlanApproved(taskId);
    } catch (err) {
      log.warn({ err, taskId }, '[manual-status] theme resume notification failed');
    }
  }
  return { outcome };
}
