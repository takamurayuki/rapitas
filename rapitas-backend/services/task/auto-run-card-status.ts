/**
 * Auto-run card status attachment
 *
 * Batches the "is auto-run on this task right now, or is it waiting its
 * turn" lookup for task-list responses, the same pattern blocked-cause.ts
 * uses for `blockedCause`: one extra query for the whole list instead of a
 * per-card round trip. Read-only; never mutates the database.
 *
 * Eligibility mirrors auto-run-eligibility.ts's eligibleTopLevelTodoWhere and
 * theme-auto-run.ts's start/pause/stop gate (`isDevelopment && working
 * Directory`) — MUST stay in sync with both; a task-list "waiting" badge that
 * disagrees with what auto-run would actually pick is worse than no badge.
 */
import type { PrismaClient } from '../../generated/prisma-postgres';

/** Minimal shape this module needs from a task-list row. */
export interface TaskLikeForAutoRunCardStatus {
  id: number;
  themeId: number | null;
  parentId: number | null;
  status: string;
  workflowStatus?: string | null;
  workflowDisabled?: boolean | null;
  autoRunExcluded?: boolean | null;
  theme?: { isDevelopment?: boolean | null; workingDirectory?: string | null } | null;
  /** True when this exact task is the theme's current auto-run pick. */
  autoRunCurrent?: boolean;
  /** True when eligible and waiting for auto-run to reach it. */
  autoRunQueued?: boolean;
  subtasks?: TaskLikeForAutoRunCardStatus[];
  [key: string]: unknown;
}

/**
 * Whether a task looks like something selectNextTask would pick: a top-level
 * (no parent) todo that isn't opted out and isn't parked on an unanswered
 * question. Mirrors auto-run-eligibility.ts's eligibleTopLevelTodoWhere.
 *
 * @param task - Task-list row. / タスク一覧行
 * @returns true when the task is a plausible auto-run candidate. / 対象候補なら true
 */
function looksAutoRunEligible(task: TaskLikeForAutoRunCardStatus): boolean {
  return (
    task.status === 'todo' &&
    task.parentId == null &&
    task.workflowDisabled !== true &&
    task.autoRunExcluded !== true &&
    (task.workflowStatus == null || task.workflowStatus !== 'awaiting_question')
  );
}

/**
 * Whether the theme itself is capable of auto-run at all. Mirrors
 * theme-auto-run.ts's `!theme.isDevelopment || !theme.workingDirectory` gate.
 *
 * @param theme - Task.theme, if loaded. / タスクのテーマ
 * @returns true when the theme supports auto-run. / 自動実行対応テーマなら true
 */
function themeSupportsAutoRun(theme: TaskLikeForAutoRunCardStatus['theme']): boolean {
  return !!theme?.isDevelopment && !!theme.workingDirectory;
}

/**
 * Whether a task's own status can never again match "selected but not yet
 * started" or "waiting its turn" — a real, unavoidable race, not just a
 * caching artifact: the scheduler writes `Task.status = 'done'` immediately
 * on completion but only moves `ThemeAutoRun.currentTaskId` to the next task
 * on its own poll tick (up to POLL_INTERVAL_MS + COOLDOWN_MS later), so a
 * request landing in that window would otherwise see a truthful-but-stale
 * `currentTaskId === task.id`. Once the task is terminal its `updatedAt`
 * never changes again, so the frontend's `since`-filtered incremental fetch
 * (task-cache-store.ts) would never re-deliver a correction — the stale
 * "次に着手" badge sticks until a full page reload.
 *
 * @param status - Task.status. / タスクのステータス
 * @returns true when the task can no longer be "next up" or "queued". / 次に着手/順番待ちになり得ない場合true
 */
function isTerminalTaskStatus(status: string): boolean {
  return status === 'done' || status === 'cancelled';
}

/** Collects every distinct themeId in the list, including nested subtasks. */
function collectThemeIds(tasks: TaskLikeForAutoRunCardStatus[]): number[] {
  const ids: number[] = [];
  for (const task of tasks) {
    if (task.themeId != null) ids.push(task.themeId);
    if (task.subtasks?.length) ids.push(...collectThemeIds(task.subtasks));
  }
  return ids;
}

/**
 * Attach `autoRunCurrent`/`autoRunQueued` to every task in `tasks`, including
 * nested subtasks. Mutates the given objects in place and also returns them
 * for convenient chaining.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param tasks - Task list to annotate. / 注釈対象のタスク一覧
 * @returns The same array, annotated in place. / 注釈済みの同一配列
 */
export async function attachAutoRunCardStatus<T extends TaskLikeForAutoRunCardStatus>(
  prisma: PrismaClient,
  tasks: T[],
): Promise<T[]> {
  const themeIds = [...new Set(collectThemeIds(tasks))];
  if (themeIds.length === 0) return tasks;

  const autoRuns = await prisma.themeAutoRun.findMany({
    where: { themeId: { in: themeIds }, enabled: true, status: 'running' },
    select: { themeId: true, currentTaskId: true },
  });
  const currentTaskIdByTheme = new Map(autoRuns.map((a) => [a.themeId, a.currentTaskId]));

  const apply = (list: T[]) => {
    for (const task of list) {
      const isAutoRunningTheme = task.themeId != null && currentTaskIdByTheme.has(task.themeId);
      if (
        isAutoRunningTheme &&
        themeSupportsAutoRun(task.theme) &&
        !isTerminalTaskStatus(task.status)
      ) {
        const current = currentTaskIdByTheme.get(task.themeId as number) === task.id;
        task.autoRunCurrent = current;
        task.autoRunQueued = !current && looksAutoRunEligible(task);
      } else {
        task.autoRunCurrent = false;
        task.autoRunQueued = false;
      }
      if (task.subtasks?.length) apply(task.subtasks as T[]);
    }
  };
  apply(tasks);

  return tasks;
}
