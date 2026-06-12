/**
 * auto-run-selection
 *
 * Pure helper functions for the theme auto-run scheduler.
 * Selects the next eligible task for a given theme without side effects,
 * making the logic unit-testable without a live DB connection.
 */
import type { PrismaClient } from '@prisma/client';

/** Minimum fields from Task used in selection logic. */
export interface SelectableTask {
  id: number;
  status: string;
  workflowStatus: string | null;
  priority: string;
  createdAt: Date;
}

/** Reason the selection returned no task. */
export type NoTaskReason = 'all_done' | 'concurrency_limit' | 'awaiting_approval';

export type SelectionResult =
  | { found: true; taskId: number }
  | { found: false; reason: NoTaskReason };

/** Auto-run concurrency constants (overridable via env). */
export const AUTO_RUN_GLOBAL_MAX_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.AUTO_RUN_GLOBAL_MAX_CONCURRENCY ?? '1', 10) || 1,
);
export const POLL_INTERVAL_MS = 12_000; // 12 s
export const COOLDOWN_MS = 3_000; // 3 s between task transitions
/**
 * Theme-level hang backstop: if a task stays the "current" task longer than
 * this, the scheduler force-stops it and skips ahead. Guards against a wedged
 * run burning tokens indefinitely (beyond WorkflowRunner's per-phase timeout).
 */
export const MAX_TASK_WALL_MS = Math.max(
  60_000,
  parseInt(process.env.AUTO_RUN_MAX_TASK_WALL_MS ?? '2700000', 10) || 2_700_000, // 45 min
);

/**
 * Task priority ordering for selection: lower number = runs first.
 * Stored priority is a STRING, so it must be ranked in JS — a SQL `desc` on the
 * string sorts alphabetically (urgent>medium>low>high), which is NOT priority order.
 */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/**
 * Resolve a priority string to its rank (higher priority → lower number).
 *
 * @param priority - Task priority string / タスク優先度
 * @returns Numeric rank; unknown/empty treated as medium / 数値ランク（不明はmedium扱い）
 */
export function priorityRank(priority: string | null | undefined): number {
  if (!priority) return PRIORITY_RANK.medium;
  const r = PRIORITY_RANK[priority.toLowerCase()];
  return r === undefined ? PRIORITY_RANK.medium : r;
}

/**
 * Return the number of auto-run queue items currently active (queued/running/waiting_approval).
 * A non-null themeId marks an item as belonging to the auto-run scheduler.
 *
 * @param prisma - Prisma client instance
 * @returns count of active auto-run items / アクティブな自動実行キューアイテム数
 */
export async function getGlobalAutoRunActiveCount(prisma: PrismaClient): Promise<number> {
  return prisma.workflowQueueItem.count({
    where: {
      themeId: { not: null },
      status: { in: ['queued', 'running', 'waiting_approval'] },
    },
  });
}

/**
 * Return all active auto-run queue items (queued/running/waiting_approval) for a specific theme.
 *
 * @param prisma - Prisma client instance
 * @param themeId - Theme ID / テーマID
 * @returns array of active queue item records / アクティブなキューアイテムの配列
 */
export async function getThemeActiveQueueItems(
  prisma: PrismaClient,
  themeId: number,
): Promise<Array<{ id: number; taskId: number; status: string }>> {
  return prisma.workflowQueueItem.findMany({
    where: {
      themeId,
      status: { in: ['queued', 'running', 'waiting_approval'] },
    },
    select: { id: true, taskId: true, status: true },
  });
}

/**
 * Determine whether a task should be skipped (was blocked by a previous failure).
 * A task is blocked when its status was explicitly set to 'blocked' by the scheduler.
 *
 * @param taskStatus - Task status string / タスクステータス
 * @returns true if the task should be skipped / スキップすべきならtrue
 */
export function isTaskBlocked(taskStatus: string): boolean {
  return taskStatus === 'blocked';
}

/**
 * Whether a task is parked WAITING FOR A USER'S ANSWER (an AskUserQuestion),
 * which execute-post-handler stores as status 'blocked' — indistinguishable from
 * a real failure by status alone. Its most recent agent execution carries an
 * unanswered question; once answered, a fresh execution (no question) supersedes
 * it. The scheduler uses this to HOLD (not advance) such a task, so it doesn't
 * treat the pause as a failure and spawn a second agent for the next task while
 * the answer-resume continues this one.
 *
 * @param prisma - Prisma client instance
 * @param taskId - Task to check / 確認対象タスク
 * @returns true when the latest execution has a pending question / 未応答の質問があればtrue
 */
export async function isAwaitingUserAnswer(prisma: PrismaClient, taskId: number): Promise<boolean> {
  const latest = await prisma.agentExecution.findFirst({
    where: { session: { config: { taskId } } },
    orderBy: { createdAt: 'desc' },
    select: { question: true },
  });
  return latest?.question != null && latest.question !== '';
}

/**
 * Select the next task to execute for a given theme.
 *
 * Eligibility criteria:
 *  - status is 'todo' or 'in-progress' (not done/cancelled/archived/blocked/failed)
 *  - workflowStatus is not 'completed' or 'verify_done' (already finished)
 *  - not the currently-running task (avoid re-enqueuing)
 *
 * @param prisma - Prisma client instance
 * @param themeId - Theme whose tasks to search / 検索対象テーマ
 * @param order - 'priority' or 'created' ordering / 優先度順か作成日順
 * @param skipTaskIds - task IDs to skip (e.g. currently running) / スキップするタスクIDセット
 * @param globalActiveCount - current global auto-run active items count / グローバルアクティブ数
 * @returns SelectionResult with taskId or reason why none was found / 選択結果
 */
export async function selectNextTask(
  prisma: PrismaClient,
  themeId: number,
  order: 'priority' | 'created',
  skipTaskIds: number[],
  globalActiveCount: number,
): Promise<SelectionResult> {
  if (globalActiveCount >= AUTO_RUN_GLOBAL_MAX_CONCURRENCY) {
    return { found: false, reason: 'concurrency_limit' };
  }

  const candidates = await prisma.task.findMany({
    where: {
      themeId,
      status: { in: ['todo', 'in-progress'] },
      // Exclude only FINISHED workflow states. A fresh task has workflowStatus
      // null and MUST stay eligible — `notIn` alone drops nulls (SQL NULL NOT IN
      // → unknown), which silently skipped every brand-new todo task.
      OR: [{ workflowStatus: null }, { workflowStatus: { notIn: ['completed', 'verify_done'] } }],
      id: skipTaskIds.length > 0 ? { notIn: skipTaskIds } : undefined,
      // Exclude subtasks — the theme scheduler drives top-level tasks only;
      // subtasks are handled by AIOrchestra.enqueueSubtasksForExecution().
      parentId: null,
    },
    // Stable createdAt order from the DB; priority is ranked in JS below.
    orderBy: [{ createdAt: 'asc' }],
    select: { id: true, status: true, workflowStatus: true, priority: true, createdAt: true },
    take: 100,
  });

  // Filter out explicitly blocked tasks
  const eligible = candidates.filter((t) => !isTaskBlocked(t.status));

  if (eligible.length === 0) {
    return { found: false, reason: 'all_done' };
  }

  // Highest priority first, ties broken by creation order (oldest first). Done
  // in JS because the stored priority is a string and can't be SQL-ordered.
  if (order === 'priority') {
    eligible.sort((a, b) => {
      const pr = priorityRank(a.priority) - priorityRank(b.priority);
      if (pr !== 0) return pr;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }
  // order === 'created' keeps the DB createdAt-asc order as-is.

  return { found: true, taskId: eligible[0]!.id };
}

/**
 * Determine if the currently-enqueued task for a theme is waiting for plan approval.
 * Returns true when the queue item status is 'waiting_approval'.
 *
 * @param queueItems - active queue items for the theme / テーマのアクティブキューアイテム
 * @returns true if ANY item is waiting_approval / waiting_approvalのアイテムがあればtrue
 */
export function hasItemAwaitingApproval(queueItems: Array<{ status: string }>): boolean {
  return queueItems.some((i) => i.status === 'waiting_approval');
}
