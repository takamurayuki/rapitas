/**
 * workflow-invariants
 *
 * Pure invariants the task + workflow_status + on-disk artifacts must satisfy
 * after any status mutation. Returns a list of violations rather than
 * throwing so the caller can record them in the transition log and still
 * decide whether to surface as a hard failure.
 *
 * Examples of caught states:
 *   - workflowStatus='plan_created' but plan.md does not exist
 *   - workflowStatus='verify_done' but research.md is missing
 *   - workflowStatus='completed' but task.status is not 'done'
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { prisma } from '../../config/database';
import { getTaskWorkflowDir } from './workflow-paths';

export interface Violation {
  /** Stable code so dashboards can group: missing_file / status_mismatch / regression. */
  code: string;
  message: string;
}

/**
 * Verify the on-disk artifacts and DB columns line up with `workflowStatus`.
 *
 * @param taskId - Task to verify. / 検査対象タスクID
 * @returns Empty array when consistent, otherwise a list of violations. / 違反リスト
 */
export async function checkWorkflowInvariants(taskId: number): Promise<Violation[]> {
  const violations: Violation[] = [];
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        workflowStatus: true,
        themeId: true,
        theme: { select: { categoryId: true } },
      },
    })
    .catch(() => null);
  if (!task) {
    return [{ code: 'task_not_found', message: `Task ${taskId} not found` }];
  }
  const dir = getTaskWorkflowDir(task.theme?.categoryId ?? null, task.themeId ?? null, taskId);
  const has = (file: string) => existsSync(join(dir, file));

  const wf = task.workflowStatus ?? 'draft';

  // Forward expectations: status implies certain files are on disk.
  if (
    (wf === 'plan_created' ||
      wf === 'plan_approved' ||
      wf === 'in_progress' ||
      wf === 'verify_done' ||
      wf === 'completed') &&
    !has('plan.md')
  ) {
    violations.push({
      code: 'missing_file',
      message: `workflowStatus="${wf}" but plan.md is missing on disk`,
    });
  }
  if (
    (wf === 'research_done' ||
      wf === 'plan_created' ||
      wf === 'plan_approved' ||
      wf === 'in_progress' ||
      wf === 'verify_done' ||
      wf === 'completed') &&
    !has('research.md')
  ) {
    violations.push({
      code: 'missing_file',
      message: `workflowStatus="${wf}" but research.md is missing on disk`,
    });
  }
  if ((wf === 'verify_done' || wf === 'completed') && !has('verify.md')) {
    violations.push({
      code: 'missing_file',
      message: `workflowStatus="${wf}" but verify.md is missing on disk`,
    });
  }

  // Cross-column consistency.
  if (wf === 'completed' && task.status !== 'done') {
    violations.push({
      code: 'status_mismatch',
      message: `workflowStatus="completed" but task.status="${task.status}" (expected "done")`,
    });
  }

  return violations;
}
