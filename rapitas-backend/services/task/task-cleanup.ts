/**
 * Task Cleanup
 *
 * Utilities for detecting and removing duplicate subtasks within a parent task.
 * Does NOT handle task creation, updates, or suggestions.
 */
import { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';
import { deleteTasksWithTrash } from './task-deletion';

type PrismaInstance = InstanceType<typeof PrismaClient>;

const logger = createLogger('task-cleanup');

/**
 * Removes duplicate subtasks (case-insensitive title match) under a single parent,
 * keeping the oldest created entry for each duplicated title.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @param parentId - Parent task ID to clean / クリーニング対象の親タスクID
 * @returns Array of deleted subtask IDs / 削除されたサブタスクIDの配列
 */
export async function cleanupDuplicateSubtasks(
  prisma: PrismaInstance,
  parentId: number,
): Promise<number[]> {
  const subtasks = await prisma.task.findMany({
    where: { parentId },
    orderBy: { createdAt: 'asc' },
  });

  const titleMap = new Map<string, typeof subtasks>();
  for (const subtask of subtasks) {
    const normalized = subtask.title.toLowerCase().trim();
    if (!titleMap.has(normalized)) {
      titleMap.set(normalized, []);
    }
    titleMap.get(normalized)!.push(subtask);
  }

  // NOTE(#1330 review): Through the deletion choke point. This used to call
  // `prisma.task.delete` directly, so a protected duplicate was removed with
  // no trash copy and no measurement snapshot — the same hole the three bulk
  // routes had, in a path the review found still open. A duplicate is still a
  // task. Only ids the guard actually deleted are reported, because a caller
  // that trusts this list would otherwise believe a task is gone.
  const candidates: number[] = [];
  for (const [, duplicates] of titleMap) {
    if (duplicates.length > 1) {
      for (const subtask of duplicates.slice(1)) candidates.push(subtask.id);
    }
  }
  if (candidates.length === 0) return [];

  const outcome = await deleteTasksWithTrash(candidates, 'user');
  logger.info(
    { parentId, deleted: outcome.deleted.length, refused: outcome.protected.length },
    '[task-cleanup] Removed duplicate subtasks',
  );

  return outcome.deleted;
}

/**
 * Scans all subtasks in the database and removes duplicates across every parent.
 *
 * @param prisma - Prisma client instance / Prismaクライアント
 * @returns Summary of deleted IDs and affected parent IDs / 削除IDと影響を受けた親IDの概要
 */
export async function cleanupAllDuplicateSubtasks(
  prisma: PrismaInstance,
): Promise<{ deletedIds: number[]; affectedParents: number[] }> {
  const allSubtasks = await prisma.task.findMany({
    where: { parentId: { not: null } },
    orderBy: { createdAt: 'asc' },
  });

  const parentMap = new Map<number, typeof allSubtasks>();
  for (const subtask of allSubtasks) {
    const parentId = subtask.parentId!;
    if (!parentMap.has(parentId)) {
      parentMap.set(parentId, []);
    }
    parentMap.get(parentId)!.push(subtask);
  }

  const deletedIds: number[] = [];
  const affectedParents: number[] = [];

  for (const [parentId, subtasks] of parentMap) {
    const titleMap = new Map<string, typeof subtasks>();
    for (const subtask of subtasks) {
      const normalized = subtask.title.toLowerCase().trim();
      if (!titleMap.has(normalized)) {
        titleMap.set(normalized, []);
      }
      titleMap.get(normalized)!.push(subtask);
    }

    // Same choke point as the single-parent sweep (#1330 review).
    const candidates: number[] = [];
    for (const [, duplicates] of titleMap) {
      if (duplicates.length > 1) {
        for (const subtask of duplicates.slice(1)) candidates.push(subtask.id);
      }
    }
    if (candidates.length === 0) continue;

    const outcome = await deleteTasksWithTrash(candidates, 'user');
    deletedIds.push(...outcome.deleted);
    logger.info(
      { parentId, deleted: outcome.deleted.length, refused: outcome.protected.length },
      '[task-cleanup] Removed duplicate subtasks',
    );

    // Marked affected only when something was actually removed: a parent whose
    // every duplicate was protected has not changed, so nothing downstream
    // needs to resync it.
    if (outcome.deleted.length > 0) {
      affectedParents.push(parentId);
    }
  }

  return { deletedIds, affectedParents };
}
