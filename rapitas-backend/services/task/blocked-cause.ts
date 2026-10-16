/**
 * Blocked-cause attachment
 *
 * Batches the "why is this task blocked" lookup for task-list responses.
 * TaskWorkflowSection (task detail page) fetches the cause per-task via
 * `/workflow/tasks/:taskId/transitions` — fine for a single page, but firing
 * that once per card in a list view would be N requests. This module instead
 * does ONE query across every blocked task id in the list and attaches the
 * latest WorkflowTransition.cause as `blockedCause`. Read-only; never
 * mutates the database.
 */
import type { PrismaClient } from '../../generated/prisma-postgres';

/** Minimal shape this module needs from a task-list row. */
export interface TaskLikeForBlockedCause {
  id: number;
  status: string;
  blockedCause?: string | null;
  subtasks?: TaskLikeForBlockedCause[];
  [key: string]: unknown;
}

/**
 * Collect the ids of every task (including nested subtasks) whose status is
 * 'blocked'.
 *
 * @param tasks - Task list to scan / 走査対象のタスク一覧
 * @returns Blocked task ids / ブロック中タスクのID一覧
 */
function collectBlockedIds(tasks: TaskLikeForBlockedCause[]): number[] {
  const ids: number[] = [];
  for (const task of tasks) {
    if (task.status === 'blocked') ids.push(task.id);
    if (task.subtasks?.length) ids.push(...collectBlockedIds(task.subtasks));
  }
  return ids;
}

/**
 * Attach `blockedCause` (the latest `WorkflowTransition.cause`) to every
 * blocked task in `tasks`, including nested subtasks. Mutates the given
 * objects in place and also returns them for convenient chaining.
 *
 * @param prisma - Prisma client / Prismaクライアント
 * @param tasks - Task list to annotate / 注釈対象のタスク一覧
 * @returns The same array, annotated in place / 注釈済みの同一配列
 */
export async function attachBlockedCauses<T extends TaskLikeForBlockedCause>(
  prisma: PrismaClient,
  tasks: T[],
): Promise<T[]> {
  const blockedIds = collectBlockedIds(tasks);
  if (blockedIds.length === 0) return tasks;

  // One round trip for the whole list: ordered desc so the first row seen
  // per taskId (below) is the latest transition.
  const rows = await prisma.workflowTransition.findMany({
    where: { taskId: { in: blockedIds } },
    orderBy: { createdAt: 'desc' },
    select: { taskId: true, cause: true },
  });

  const latestByTaskId = new Map<number, string>();
  for (const row of rows) {
    if (!latestByTaskId.has(row.taskId)) {
      latestByTaskId.set(row.taskId, row.cause);
    }
  }

  const apply = (list: T[]) => {
    for (const task of list) {
      if (task.status === 'blocked') {
        task.blockedCause = latestByTaskId.get(task.id) ?? null;
      }
      if (task.subtasks?.length) apply(task.subtasks as T[]);
    }
  };
  apply(tasks);

  return tasks;
}
