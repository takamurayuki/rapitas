/**
 * Completed-Task Cleanup
 *
 * Prunes old COMPLETED tasks to keep the task list manageable. Before deleting a
 * task it makes sure its lessons are captured in the knowledge base: if the task
 * has no KnowledgeEntry yet, it extracts knowledge first; if it already does, it
 * just deletes. Deletion also removes any git worktrees; the task's workflow
 * artifacts cascade-delete with the Task row (WorkflowFile/WorkflowFileVersion
 * both have onDelete: Cascade). Manual trigger only (see the
 * /tasks/cleanup-completed route). Not responsible for scheduling or for
 * duplicate-subtask cleanup (task-cleanup.ts).
 */
import { prisma } from '../../config/database';
import { getProjectRoot } from '../../config';
import { createLogger } from '../../config/logger';
import { removeWorktree } from '../agents/orchestrator/git-operations/worktree/worktree-ops';
import { extractKnowledgeFromTask } from '../memory/task-knowledge-extractor';

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
 * Delete a single task and ALL of its execution artifacts: git worktrees, the
 * workflow md directory on disk, and (via Prisma cascade) its DB rows. The
 * workflow dir must be removed BEFORE the task row (its path is derived from the
 * task's theme/category).
 *
 * @param taskId - Task to delete. / 削除するタスクID
 */
async function deleteTaskWithArtifacts(taskId: number): Promise<void> {
  // 1. Remove any git worktrees for this task.
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { workingDirectory: true, theme: { select: { workingDirectory: true } } },
    });
    const sessions = await prisma.agentSession.findMany({
      where: { worktreePath: { not: null }, config: { taskId } },
      select: { id: true, worktreePath: true },
    });
    const baseDir = task?.workingDirectory ?? task?.theme?.workingDirectory ?? getProjectRoot();
    for (const s of sessions) {
      if (!s.worktreePath) continue;
      try {
        await removeWorktree(baseDir, s.worktreePath);
        await prisma.agentSession
          .update({ where: { id: s.id }, data: { worktreePath: null } })
          .catch(() => {});
      } catch (wtErr) {
        log.warn(
          { err: wtErr, taskId, worktreePath: s.worktreePath },
          '[cleanup] worktree remove failed',
        );
      }
    }
  } catch (err) {
    log.warn({ err, taskId }, '[cleanup] worktree cleanup failed — proceeding');
  }

  // 2. Delete the task row (cascades WorkflowFile / WorkflowFileVersion /
  //    WorkflowTransition / sessions etc.). KnowledgeEntry.taskId is NOT a FK,
  //    so recorded knowledge survives.
  await prisma.task.delete({ where: { id: taskId } });
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

      await deleteTaskWithArtifacts(t.id);
      result.deletedCount++;
      result.deletedTaskIds.push(t.id);
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
