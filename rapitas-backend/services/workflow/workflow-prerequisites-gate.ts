/**
 * workflow-prerequisites-gate
 *
 * Refuses to start a task's workflow while a task it depends on is not done
 * (開始条件, #1559), with the open prerequisites named so the person knows
 * what to finish first. Auto-run never selects such a task, so this is the
 * manual start's check. Fails open on a read error: a dependency lookup that
 * cannot be made must not stop every start. Not responsible for storing
 * dependencies (`task/task-dependencies.ts`).
 */
import { createLogger } from '../../config/logger';
import { openPrerequisites, prerequisitesMessage } from '../task/task-dependencies';
import type { WorkflowAdvanceResult } from './workflow-agent-executor';

const log = createLogger('workflow-prerequisites-gate');

/**
 * The refusal to return when prerequisites are still open, or null to go on.
 *
 * @param taskId - The task about to start / 開始するタスク
 * @param role - The phase's role, echoed in the result / フェーズの役割
 * @param status - The current workflow status, kept / 現在の状態
 * @returns A failed advance naming the prerequisites, or null / 拒否結果か null
 */
export async function refuseWhilePrerequisitesOpen(
  taskId: number,
  role: WorkflowAdvanceResult['role'],
  status: WorkflowAdvanceResult['status'],
): Promise<WorkflowAdvanceResult | null> {
  try {
    const open = await openPrerequisites(taskId);
    if (open.length === 0) return null;
    return { success: false, role, status, error: prerequisitesMessage(open) };
  } catch (err) {
    log.warn({ err, taskId }, '[prerequisites] could not read prerequisites — starting anyway');
    return null;
  }
}
