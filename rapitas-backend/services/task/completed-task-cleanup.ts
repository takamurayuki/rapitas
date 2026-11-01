/**
 * Completed-Task Cleanup
 *
 * Prunes old COMPLETED tasks to keep the task list manageable. Before deleting a
 * task it makes sure its lessons are captured in the knowledge base: if the task
 * has no KnowledgeEntry yet, it extracts knowledge first; if it already does, it
 * just deletes. Manual trigger only (see the /tasks/cleanup-completed route).
 *
 * Decides WHICH tasks go; `task-deletion.ts` decides what deleting one means
 * (protected check, worktrees, trash copy, measurement snapshot, cascade).
 * Not responsible for scheduling or for duplicate-subtask cleanup
 * (task-cleanup.ts).
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { extractKnowledgeFromTask } from '../memory/task-knowledge-extractor';
import { deleteTaskWithTrash } from './task-deletion';

const log = createLogger('completed-task-cleanup');

/** Default number of most-recent completed tasks to keep. */
export const DEFAULT_KEEP_RECENT = 100;
/** Statuses considered "completed" (eligible for cleanup). */
const COMPLETED_STATUSES = ['done', 'completed'];
/** Terminal subtask statuses — a parent with a non-terminal child is not pruned. */
const TERMINAL_SUBTASK_STATUSES = ['done', 'completed', 'failed', 'cancelled', 'archived'];

export interface CleanupOptions {
  /** Keep this many most-recent completed tasks; delete older ones. */
  keepRecent?: number;
  /** When true, report what WOULD be deleted without deleting. */
  dryRun?: boolean;
  /** Restrict to a single theme. When omitted/null, all themes are pruned. */
  themeId?: number | null;
}

export interface CleanupResult {
  dryRun: boolean;
  keepRecent: number;
  /** Theme the run was scoped to, or null for all themes. */
  themeId: number | null;
  completedTotal: number;
  /** Completed tasks beyond keepRecent that are eligible to prune. */
  candidateCount: number;
  deletedCount: number;
  /** Of the deleted, how many had knowledge extracted now (were not yet recorded). */
  knowledgeRecorded: number;
  /** Of the deleted, how many already had knowledge (delete-only). */
  alreadyRecorded: number;
  /** Candidates skipped because they still have non-terminal subtasks. */
  skippedWithOpenSubtasks: number;
  deletedTaskIds: number[];
}

/**
 * Delete one pruned task through the shared deletion choke point.
 *
 * NOTE(#1330 review): this used to clear the worktrees, snapshot the
 * measurements and call `prisma.task.delete` itself — so the 921 tasks it
 * pruned went with no trash copy, and a task marked protected between the
 * candidate query and the delete was removed anyway. The choke point does
 * all three (protected check, worktrees, trash + measurements), and the
 * worktree grouping this file carried for #825 moved there with it.
 *
 * @param taskId - Task to delete. / 削除するタスクID
 * @returns Whether the task was actually removed / 実際に削除されたか
 */
async function deleteTaskWithArtifacts(taskId: number): Promise<boolean> {
  const outcome = await deleteTaskWithTrash(taskId, 'user');
  if (outcome.outcome === 'protected') {
    log.info({ taskId }, '[cleanup] refused: task became protected since it was selected');
    return false;
  }
  // `not_found` means something else already removed it — the task is gone,
  // which is what was wanted, but this run did not do it, so it is not
  // reported as pruned.
  return outcome.outcome === 'deleted';
}

/**
 * Prune old completed tasks, capturing knowledge first when needed.
 *
 * @param opts - keepRecent / dryRun options. / 保持件数・ドライラン
 * @returns Summary of what was (or would be) pruned. / 実行結果サマリ
 */
export async function cleanupCompletedTasks(opts: CleanupOptions = {}): Promise<CleanupResult> {
  const keepRecent = Math.max(0, Math.floor(opts.keepRecent ?? DEFAULT_KEEP_RECENT));
  const dryRun = opts.dryRun === true;
  const themeId = typeof opts.themeId === 'number' ? opts.themeId : null;

  // Top-level completed tasks, newest first, optionally scoped to one theme.
  // keepRecent then applies WITHIN that scope. Subtasks are removed with their
  // parent (cascade), so we only choose among top-level tasks here.
  const completed = await prisma.task.findMany({
    where: {
      parentId: null,
      status: { in: COMPLETED_STATUSES },
      // Protected tasks are never pruned, even when completed and beyond
      // keepRecent. Excluding them here keeps completedTotal / candidate counts
      // accurate for the dryRun preview.
      isProtected: { not: true },
      ...(themeId !== null ? { themeId } : {}),
    },
    orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
    select: { id: true },
  });

  const candidates = completed.slice(keepRecent);
  const result: CleanupResult = {
    dryRun,
    keepRecent,
    themeId,
    completedTotal: completed.length,
    candidateCount: candidates.length,
    deletedCount: 0,
    knowledgeRecorded: 0,
    alreadyRecorded: 0,
    skippedWithOpenSubtasks: 0,
    deletedTaskIds: [],
  };

  for (const t of candidates) {
    try {
      // Never prune a parent that still has a non-terminal subtask.
      const openSubtasks = await prisma.task.count({
        where: { parentId: t.id, status: { notIn: TERMINAL_SUBTASK_STATUSES } },
      });
      if (openSubtasks > 0) {
        result.skippedWithOpenSubtasks++;
        continue;
      }

      // NOTE: No `.catch()` here — a thrown error must propagate to the
      // per-task try/catch below, which SKIPS (does not delete) the task this
      // cycle. A bare `.catch(() => 0)` would make a transient DB failure look
      // identical to "no knowledge recorded yet", which — combined with the
      // extraction call below — could delete a task whose lessons were never
      // actually verified as captured.
      const hasKnowledge = (await prisma.knowledgeEntry.count({ where: { taskId: t.id } })) > 0;

      if (dryRun) {
        // Count what the real run would do, without recording or deleting.
        if (hasKnowledge) result.alreadyRecorded++;
        else result.knowledgeRecorded++;
        result.deletedTaskIds.push(t.id);
        result.deletedCount++;
        continue;
      }

      if (hasKnowledge) {
        result.alreadyRecorded++;
      } else {
        // Capture lessons before the task (and its verify.md) are gone.
        // NOTE: No `.catch()` — see the knowledgeEntry.count note above. A
        // thrown extraction error must also skip deletion this cycle rather
        // than be conflated with "extraction ran fine and genuinely found
        // nothing" (ids.length === 0 on a successful call).
        const ids = await extractKnowledgeFromTask(t.id);
        if (ids.length > 0) result.knowledgeRecorded++;
        // If nothing was extractable, we still delete — there is nothing to keep.
      }

      // Counted only when it actually went: a caller that trusts deletedCount
      // would otherwise believe a protected task is gone while it is still
      // there — the same "reported as deleted without being deleted" bug the
      // #1330 review found in the bulk routes.
      if (await deleteTaskWithArtifacts(t.id)) {
        result.deletedCount++;
        result.deletedTaskIds.push(t.id);
      }
    } catch (err) {
      log.warn({ err, taskId: t.id }, '[cleanup] Failed to prune task — skipping');
    }
  }

  log.info(
    {
      dryRun,
      keepRecent,
      themeId,
      completedTotal: result.completedTotal,
      deleted: result.deletedCount,
      knowledgeRecorded: result.knowledgeRecorded,
      alreadyRecorded: result.alreadyRecorded,
      skipped: result.skippedWithOpenSubtasks,
    },
    '[cleanup] Completed-task cleanup finished',
  );
  return result;
}
