/**
 * Task Cleanup
 *
 * Utilities for detecting and removing duplicate subtasks within a parent task.
 * Does NOT handle task creation, updates, or suggestions.
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../../config/logger';

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

  const deletedIds: number[] = [];
  for (const [, duplicates] of titleMap) {
    if (duplicates.length > 1) {
      const toDelete = duplicates.slice(1);
      for (const subtask of toDelete) {
        await prisma.task.delete({ where: { id: subtask.id } });
        deletedIds.push(subtask.id);
        logger.info(
          `[task-cleanup] Deleted duplicate subtask: "${subtask.title}" (id: ${subtask.id})`,
        );
      }
    }
  }

  return deletedIds;
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

    let parentHadDuplicates = false;
    for (const [, duplicates] of titleMap) {
      if (duplicates.length > 1) {
        parentHadDuplicates = true;
        const toDelete = duplicates.slice(1);
        for (const subtask of toDelete) {
          await prisma.task.delete({ where: { id: subtask.id } });
          deletedIds.push(subtask.id);
          logger.info(
            `[task-cleanup] Deleted duplicate subtask: "${subtask.title}" (id: ${subtask.id}, parent: ${parentId})`,
          );
        }
      }
    }

    if (parentHadDuplicates) {
      affectedParents.push(parentId);
    }
  }

  return { deletedIds, affectedParents };
}
