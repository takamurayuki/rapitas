/**
 * workflow-runner-plan-approval
 *
 * The WorkflowRunner's handling of a task sitting at plan_created: wait for a
 * human, hand the item back, or auto-approve. Not responsible for judging or
 * bouncing the plan (phase-critic) or for the rest of the phase loop.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { isTaskExecutionLocked } from '../agents/task-execution-lock';
import { awaitCriticSettled, hasCritiqueInFlight } from './phase-critic/critic-inflight';
import { shouldAutoApprovePlan } from './workflow-runner-item-helpers';
import type { WorkflowQueueService } from './workflow-queue';

const log = createLogger('workflow-runner');

/**
 * Settle one loop pass for a plan_created task.
 *
 * @param queue - The item's guarded queue writer. / 所有確認付きのキュー書き込み
 * @param item - Queue item id and task id. / キュー項目
 * @param broadcast - Runner event broadcaster. / 配信関数
 * @returns 'continue' to re-read the status, 'break' to leave the loop. / ループの次の動き
 */
export async function settlePlanCreated(
  queue: Pick<WorkflowQueueService, 'updateStatus'>,
  item: { id: number; taskId: number },
  broadcast: (itemId: number, taskId: number, event: string, phase: string) => void,
): Promise<'continue' | 'break'> {
  if (!(await shouldAutoApprovePlan(item.taskId))) {
    await queue.updateStatus(item.id, 'waiting_approval', { currentPhase: 'plan_created' });
    broadcast(item.id, item.taskId, 'waiting_approval', 'plan_created');
    return 'break';
  }

  // NOTE: No await may be added between these two checks and the update below.
  // The CLI harvest path writes plan_created and registers its critique while
  // holding the execution lock, so a held lock means the critique may be unseen.
  if (isTaskExecutionLocked(item.taskId)) {
    await queue.updateStatus(item.id, 'queued', { currentPhase: 'plan_created' });
    broadcast(item.id, item.taskId, 'execution_requeued', 'plan_created');
    return 'break';
  }
  // NOTE: Approving mid-critique makes its late bounce miss and be discarded
  // (task 1593). Nothing is written after the wait: the loop head re-checks stop,
  // ownership and the status the verdict may have changed.
  if (hasCritiqueInFlight(item.taskId)) {
    await awaitCriticSettled(item.taskId);
    return 'continue';
  }
  // NOTE: Conditional on plan_created so a bounce or a human decision made since
  // the status was read is not overwritten. Keep task.status in sync with the
  // workflow phase so the subtask-completion handler (which reads both fields)
  // never sees a stale status and strands the parent.
  const approved = await prisma.task.updateMany({
    where: { id: item.taskId, workflowStatus: 'plan_created' },
    data: { workflowStatus: 'plan_approved', status: 'in-progress' },
  });
  if (approved.count === 1) {
    broadcast(item.id, item.taskId, 'phase_completed', 'plan_created');
    log.info(`[WorkflowRunner] Plan auto-approved for task ${item.taskId}`);
  }
  return 'continue';
}
