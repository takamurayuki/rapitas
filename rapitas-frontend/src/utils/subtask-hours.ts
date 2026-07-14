/**
 * subtask-hours
 *
 * Helpers for aggregating work-time (actualHours) across a task's subtasks.
 * Not responsible for estimated-hours aggregation or persistence.
 */

import type { Task } from '@/types';

/**
 * Sums the registered work time (actualHours) across subtasks.
 *
 * The parent's displayed work time must reflect the subtask total whenever at
 * least one subtask has work time registered, so callers use a `null` return
 * to fall back to the parent's own actualHours.
 *
 * @param subtasks - Subtask list (may be undefined when not loaded) / サブタスク一覧
 * @returns Total hours, or `null` when no subtask has work time registered / 合計時間(未登録ならnull)
 */
export function sumSubtaskActualHours(subtasks: Task[] | undefined | null): number | null {
  const withHours = (subtasks ?? []).filter((s) => s.actualHours != null);
  if (withHours.length === 0) return null;
  return withHours.reduce((sum, s) => sum + (s.actualHours ?? 0), 0);
}
