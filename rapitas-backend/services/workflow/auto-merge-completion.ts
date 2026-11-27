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
import { completeWithRecord } from '../notes/deliverables/deliverable-completion';

const log = createLogger('workflow:auto-merge-completion');

/**
 * Mark a held task row done/completed, exactly once. Used when the watcher is the one
 * that reaches a task's completion point under staged completion.
 *
 * @param taskId - Task the watcher reached completion for / 完了点に達したタスクID
 * @returns True only when THIS call wrote the completion (and its record); a task that is already
 *   completed or no longer held returns false / この呼び出しが完了を書き込めた場合のみ true
 */
export async function completeTaskRow(taskId: number): Promise<boolean> {
  if (!(await canContinueAutoMerge(taskId))) return false;
  // NOTE: Both callers (merge success, pr-mode CI green) land here; the stop
  // guard alone let an unconfirmed verifier complete (G2 routing1 re-review 3).
  if (!(await verifierConfirmedForCompletion(taskId, 'merge_watcher'))) return false;
  // Notes stage 1: the completion and its deliverable record (mode ci_merge)
  // are one transaction with one time (completedAt = updatedAt = the record's).
  return completeWithRecord(prisma as never, taskId, 'ci_merge', (db, at) =>
    db.task.updateMany({
      // Task 1568: ONE writer, conditional on the held shape — a second call (or a runner
      // recovery that got there first) matches nothing and records nothing.
      where: { id: taskId, status: 'in-progress', workflowStatus: 'verify_done' },
      data: { status: 'done', workflowStatus: 'completed', completedAt: at, updatedAt: at },
    }),
  ).catch((err) => {
    log.warn({ err, taskId }, '[auto-merge] completeTaskRow failed');
    return false;
  });
}
