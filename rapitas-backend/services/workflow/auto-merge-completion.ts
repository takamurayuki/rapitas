/**
 * auto-merge-completion
 *
 * The merge watcher's task completion write (merge success in merge mode, CI
 * green in pr mode), behind the stop guard and the verifier re-check. Not
 * responsible for deciding that the PR is ready — the watcher does that.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { canContinueAutoMerge } from './auto-merge-task-guard';
import { verifierConfirmedForCompletion } from './verifier-completion-check';

const log = createLogger('workflow:auto-merge-completion');

/**
 * Mark a task row done/completed (idempotent). Used when the watcher is the one
 * that reaches a task's completion point under staged completion.
 *
 * @param taskId - Task the watcher reached completion for / 完了点に達したタスクID
 * @returns True when the row was written / 完了を書き込めた場合 true
 */
export async function completeTaskRow(taskId: number): Promise<boolean> {
  if (!(await canContinueAutoMerge(taskId))) return false;
  // NOTE: Both callers (merge success, pr-mode CI green) land here; the stop
  // guard alone let an unconfirmed verifier complete (G2 routing1 re-review 3).
  if (!(await verifierConfirmedForCompletion(taskId, 'merge_watcher'))) return false;
  const result = await prisma.task
    .updateMany({
      where: { id: taskId, status: { in: ['in-progress', 'in_progress', 'done', 'completed'] } },
      data: { status: 'done', workflowStatus: 'completed', completedAt: new Date() },
    })
    .catch((err) => {
      log.warn({ err, taskId }, '[auto-merge] completeTaskRow failed');
      return { count: 0 };
    });
  return result.count > 0;
}
