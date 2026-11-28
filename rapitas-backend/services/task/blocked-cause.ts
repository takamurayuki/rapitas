/**
 * Blocked-cause attachment
 *
 * Batches the "why is this task blocked" lookup for task-list responses.
 * TaskWorkflowSection (task detail page) fetches the cause per-task via
 * `/workflow/tasks/:taskId/transitions` — fine for a single page, but firing
 * that once per card in a list view would be N requests. This module instead
 * does ONE query across every blocked task id in the list and attaches the
 * latest WorkflowTransition.cause as `blockedCause`, suffixed with the names of
 * the checks that stopped it. Read-only; never mutates the database.
 */
import type { PrismaClient } from '../../generated/prisma-postgres';

/** Stop records and the metadata key naming their checks. */
const CHECK_NAME_KEYS: Record<string, string> = {
  verification_stopped: 'failedChecks',
  verification_unverifiable_hold: 'unverifiableChecks',
};

/**
 * Follow-up rows written after a stop. They would hide which check stopped the task.
 * NOTE: Keep in step with the frontend's workflow-blocked-cause.ts.
 */
const FOLLOW_UP_CAUSES = new Set([
  'verify_pr_not_created',
  'verification_gate_failed',
  'verification_gate_repeat_hold',
]);

interface CauseRow {
  cause: string;
  metadata?: string | null;
}

/** `<cause>:<check,check>`, or the bare cause when the metadata is unusable. */
function describeStop(row: CauseRow): string {
  try {
    const metadata = JSON.parse(row.metadata ?? '') as Record<string, unknown> | null;
    const names = metadata?.[CHECK_NAME_KEYS[row.cause]];
    const checks = Array.isArray(names) ? names.filter((n) => typeof n === 'string') : [];
    return checks.length ? `${row.cause}:${checks.join(',')}` : row.cause;
  } catch {
    return row.cause;
  }
}

/** Cause to show for one task's rows, newest first. */
function displayCause(rows: CauseRow[]): string | null {
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(CHECK_NAME_KEYS, row.cause)) return describeStop(row);
    if (!FOLLOW_UP_CAUSES.has(row.cause)) break;
  }
  return rows[0]?.cause ?? null;
}

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
 * Attach `blockedCause` (the latest `WorkflowTransition.cause`, or the stop
 * record behind its follow-up rows) to every blocked task in `tasks`, including
 * nested subtasks. Mutates the given objects in place and also returns them.
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

  // One round trip for the whole list: ordered desc so each task's rows are
  // grouped newest first.
  const rows = await prisma.workflowTransition.findMany({
    where: { taskId: { in: blockedIds } },
    orderBy: { createdAt: 'desc' },
    select: { taskId: true, cause: true, metadata: true },
  });

  const rowsByTaskId = new Map<number, CauseRow[]>();
  for (const row of rows) {
    const list = rowsByTaskId.get(row.taskId);
    if (list) list.push(row);
    else rowsByTaskId.set(row.taskId, [row]);
  }

  const apply = (list: T[]) => {
    for (const task of list) {
      if (task.status === 'blocked') {
        task.blockedCause = displayCause(rowsByTaskId.get(task.id) ?? []);
      }
      if (task.subtasks?.length) apply(task.subtasks as T[]);
    }
  };
  apply(tasks);

  return tasks;
}
