/**
 * auto-merge-task-guard
 *
 * Recheck durable task/theme state and the persisted stop intent at each
 * asynchronous publication boundary of the auto-merge watcher.
 * Not responsible for candidate discovery or the merge itself.
 */
import { prisma } from '../../config/database';
import { isLatestExecutionCancelled } from './publication-cancellation-guard';

/**
 * Whether the watcher may still merge / complete this task right now.
 *
 * Fails CLOSED on any DB error: a merge is irreversible, so an unreadable
 * state must not be read as permission.
 *
 * @param taskId - Candidate task. / 対象タスクID
 * @param opts.mergeLanded - The PR is already merged; only a stop withholds the completion. / マージ済み
 * @returns True when the merge/completion may proceed. / 続行してよい場合 true
 */
export async function canContinueAutoMerge(
  taskId: number,
  opts: { mergeLanded?: boolean } = {},
): Promise<boolean> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { status: true, themeId: true },
    });
    if (!task || !['in-progress', 'in_progress', 'done', 'completed'].includes(task.status))
      return false;
    // NOTE: The auto-run toggle governs what the watcher STARTS (a merge). A
    // merge someone already made is a fact; a task run by hand while auto-run
    // was off stayed at verify_done after its PR merged (trial #1499).
    if (task.themeId != null && !opts.mergeLanded) {
      const run = await prisma.themeAutoRun.findFirst({
        where: { themeId: task.themeId },
        select: { enabled: true, status: true },
      });
      if (run && (!run.enabled || run.status !== 'running')) return false;
    }
    // A stop can land while the task row still reads in-progress (stop-task-agents
    // cancels the EXECUTION; task.status is not always flipped). Only the LATEST
    // execution counts, so a task stopped once and legitimately re-run is not
    // blocked forever by that history (task 895).
    if (await isLatestExecutionCancelled(taskId)) return false;
    return true;
  } catch {
    return false;
  }
}
