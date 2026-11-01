/**
 * TaskDeletion
 *
 * What it means to delete a task: refuse if it is protected, clear its
 * worktrees, keep a copy, then delete.
 *
 * One implementation on purpose. `DELETE /tasks/:id` used to be "the single
 * choke point for ALL manual delete paths" because every UI route happened to
 * call it; ラピ deleting tasks adds a caller that is not an HTTP request, and
 * a second copy of the protected-task guard is a guard that will drift. So
 * the choke point moved here and the route became one of its callers.
 *
 * Not responsible for deciding WHICH tasks should go — see the assistant
 * routes for that, and note that it is the user who decides, from a list.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { cleanUpTaskWorktrees } from './task-worktree-cleanup';
import { snapshotTaskForTrash, type TrashSource } from './task-trash';
import { snapshotTaskMeasurements } from './task-measurement-snapshot';

const logger = createLogger('task-deletion');

/** How a deletion attempt ended. */
export type DeletionOutcome =
  /** Gone, and recoverable from the trash. */
  | 'deleted'
  /** Refused: the task is marked protected. */
  | 'protected'
  /** There was nothing with that id. */
  | 'not_found';

export interface DeletionResult {
  taskId: number;
  outcome: DeletionOutcome;
  /** The trash row to restore from, when one was written. */
  trashId?: number;
}

/**
 * Whether an error is Prisma saying the row a write named no longer exists.
 *
 * Matched on the code rather than with `instanceof`: this repository
 * generates two Prisma clients (postgres and sqlite, see ADR-0006), so there
 * are two distinct `PrismaClientKnownRequestError` classes and neither one
 * recognises the other's instances.
 *
 * @param err - The thrown value / 投げられた値
 * @returns True when it is P2025 / P2025 のとき true
 */
function isRecordNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2025';
}

/**
 * Delete one task, keeping a copy so it can be brought back.
 *
 * @param taskId - The task to delete / 削除するタスク
 * @param source - Who asked / 削除を要求した主体
 * @returns What happened, and where the copy went / 結果と退避先
 */
export async function deleteTaskWithTrash(
  taskId: number,
  source: TrashSource,
): Promise<DeletionResult> {
  // Checked before any worktree cleanup, so a task we are not going to delete
  // never has anything touched.
  const guard = await prisma.task.findUnique({
    where: { id: taskId },
    select: { isProtected: true },
  });
  if (!guard) return { taskId, outcome: 'not_found' };
  if (guard.isProtected) {
    logger.info({ taskId, source }, 'refused: task is protected');
    return { taskId, outcome: 'protected' };
  }

  await cleanUpTaskWorktrees(taskId);

  // Before the delete, because the cascade reaches 43 relations and
  // afterwards there is nothing left to copy.
  const trashId = await snapshotTaskForTrash(taskId, source);

  // The trash copy keeps the task; it does not keep what the task cost. The
  // same cascade takes the executions and the workflow transitions, so the
  // numbers are copied out separately, to a table the cascade cannot reach.
  await snapshotTaskMeasurements(taskId, prisma);

  try {
    await prisma.task.delete({ where: { id: taskId } });
  } catch (err) {
    // The guard above and this delete are not one atomic step — clearing
    // worktrees and copying 43 relations happen in between, which is long
    // enough for something else to remove the row: a parent's cascade, the
    // task list, a backlog job. The task is gone, which is what was wanted,
    // so this is not a failure to report. Only P2025 is absorbed; a database
    // that is down must not be read as "there was nothing with that id".
    if (!isRecordNotFound(err)) throw err;
    logger.info({ taskId, source, trashId }, 'task was already gone by the time we deleted it');
    return { taskId, outcome: 'not_found' };
  }
  logger.info({ taskId, source, trashId }, 'task deleted');

  return { taskId, outcome: 'deleted', ...(trashId !== null ? { trashId } : {}) };
}

/** What a bulk deletion did, split by outcome. */
export interface BulkDeletionResult {
  /** Ids that were deleted and are recoverable from the trash. */
  deleted: number[];
  /** Ids refused because the task is marked protected. */
  protected: number[];
  /** Ids that had no task. */
  notFound: number[];
  /** Trash rows to restore from, one per deleted id. */
  trashIds: number[];
}

/**
 * Delete several tasks through the SAME guarded path as a single delete.
 *
 * NOTE: This exists because three callers did not use this module at all
 * (#1330): the batch API's `DELETE:/tasks/:id` and both subtask-bulk routes
 * each called `prisma.task.delete` / `deleteMany` directly. A protected task
 * that the single-task route refuses was therefore removed through the batch,
 * with no trash copy to restore from and no measurement snapshot, while the
 * cascade took 43 relations with it. `tasks.ts` had already written the hazard
 * down — "one guard in two places is a guard that drifts" — so the answer is
 * another entry point HERE, not another copy of the guard there.
 *
 * Deliberately sequential, one full pass per task. A single `deleteMany` is
 * faster but cannot refuse a protected row, cannot write a trash copy and
 * cannot snapshot measurements — the three things that make a delete
 * recoverable. Correctness over speed, on a path that destroys data.
 *
 * @param taskIds - The tasks to delete; duplicates are collapsed / 削除対象（重複は畳む）
 * @param source - Who asked / 削除を要求した主体
 * @returns Each id sorted into what happened to it / 各IDの結果内訳
 */
export async function deleteTasksWithTrash(
  taskIds: number[],
  source: TrashSource,
): Promise<BulkDeletionResult> {
  const result: BulkDeletionResult = {
    deleted: [],
    protected: [],
    notFound: [],
    trashIds: [],
  };
  for (const taskId of [...new Set(taskIds)]) {
    const one = await deleteTaskWithTrash(taskId, source);
    if (one.outcome === 'deleted') {
      result.deleted.push(taskId);
      if (one.trashId !== undefined) result.trashIds.push(one.trashId);
    } else if (one.outcome === 'protected') {
      result.protected.push(taskId);
    } else {
      result.notFound.push(taskId);
    }
  }
  return result;
}
