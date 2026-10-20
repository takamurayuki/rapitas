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

  await prisma.task.delete({ where: { id: taskId } });
  logger.info({ taskId, source, trashId }, 'task deleted');

  return { taskId, outcome: 'deleted', ...(trashId !== null ? { trashId } : {}) };
}
