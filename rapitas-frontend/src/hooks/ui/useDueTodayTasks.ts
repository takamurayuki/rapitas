'use client';
/**
 * useDueTodayTasks
 *
 * Derives today's due tasks directly from the shared task-cache-store (Zustand).
 * Because the store is updated optimistically on every status change and synced
 * incrementally in the background, this hook reflects changes immediately —
 * no separate HTTP polling is needed.
 *
 * Does NOT include subtasks (store only holds top-level parentId=null tasks).
 */
import { useMemo } from 'react';
import { useTaskCacheStore } from '@/stores/task-cache-store';

export interface DueTodayTask {
  id: number;
  title: string;
  status: string;
}

export interface UseDueTodayTasksResult {
  tasks: DueTodayTask[];
  completedCount: number;
  totalCount: number;
  isLoading: boolean;
}

/**
 * Returns local-timezone start/end timestamps for today as UTC milliseconds.
 * Called each render so midnight rollovers are handled correctly.
 *
 * @returns Start and end of today in local time as UTC ms / ローカル今日の開始・終了(UTC ms)
 */
function todayLocalBounds(): { start: number; end: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  return { start, end };
}

export function useDueTodayTasks(): UseDueTodayTasksResult {
  const storeTasks = useTaskCacheStore((s) => s.tasks);
  const isLoading = useTaskCacheStore((s) => !s.initialized);

  const tasks = useMemo<DueTodayTask[]>(() => {
    const { start, end } = todayLocalBounds();
    return storeTasks
      .filter((t) => {
        if (!t.dueDate) return false;
        const ts = new Date(t.dueDate).getTime();
        return ts >= start && ts <= end;
      })
      .map((t) => ({ id: t.id, title: t.title, status: t.status }));
  }, [storeTasks]);

  const completedCount = useMemo(() => tasks.filter((t) => t.status === 'done').length, [tasks]);

  return { tasks, completedCount, totalCount: tasks.length, isLoading };
}
