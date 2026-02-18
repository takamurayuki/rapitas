import { useMemo } from 'react';
import type { Task, Theme, Category, Priority } from '@/types';

interface UseFilteredTasksProps {
  tasks: Task[];
  filter: string;
  categoryFilter: number | null;
  themeFilter: number | null;
  priorityFilter: Priority | null;
  searchQuery: string;
  themes: Theme[];
}

interface UseFilteredTasksResult {
  filteredTasks: Task[];
  statusCounts: Record<string, number>;
  todayTasksCounts: { total: number; completed: number };
}

export function useFilteredTasks({
  tasks,
  filter,
  categoryFilter,
  themeFilter,
  priorityFilter,
  searchQuery,
  themes,
}: UseFilteredTasksProps): UseFilteredTasksResult {
  // カテゴリに属するテーマIDのセットを計算
  const categoryThemeIds = useMemo(() => {
    if (categoryFilter === null) return null;
    return new Set(
      themes.filter((t) => t.categoryId === categoryFilter).map((t) => t.id),
    );
  }, [categoryFilter, themes]);

  // フィルタリングロジックを一箇所に集約
  const { filteredTasks, statusCounts } = useMemo(() => {
    const counts: Record<string, number> = {
      all: 0,
      todo: 0,
      'in-progress': 0,
      done: 0,
    };

    const filtered = tasks.filter((t) => {
      if (t.parentId) return false;

      // フィルタリング条件
      const statusMatch = filter === 'all' || t.status === filter;
      const themeMatch = themeFilter === null || t.themeId === themeFilter;
      const categoryMatch =
        themeFilter !== null || // テーマが選択されている場合はカテゴリフィルタをスキップ
        categoryThemeIds === null ||
        (t.themeId && categoryThemeIds.has(t.themeId));
      const priorityMatch =
        priorityFilter === null || t.priority === priorityFilter;
      const searchMatch =
        !searchQuery ||
        t.title.toLowerCase().includes(searchQuery.toLowerCase());

      // すべての条件に一致するかチェック
      const matches =
        statusMatch &&
        themeMatch &&
        categoryMatch &&
        priorityMatch &&
        searchMatch;

      // カウント更新（テーマとカテゴリの条件は常に適用）
      if (themeMatch && categoryMatch && priorityMatch && searchMatch) {
        counts.all++;
        if (t.status === 'todo') counts.todo++;
        else if (t.status === 'in-progress') counts['in-progress']++;
        else if (t.status === 'done') counts.done++;
      }

      return matches;
    });

    return { filteredTasks: filtered, statusCounts: counts };
  }, [
    tasks,
    filter,
    categoryFilter,
    themeFilter,
    priorityFilter,
    searchQuery,
    categoryThemeIds,
  ]);

  // 今日のタスクのカウント（選択されたテーマでフィルタリング）
  const todayTasksCounts = useMemo(() => {
    // カテゴリにテーマがない場合は、本日のタスクをカウントしない
    if (categoryFilter !== null && categoryThemeIds && categoryThemeIds.size === 0) {
      return { total: 0, completed: 0 };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTasks = tasks.filter((t) => {
      if (t.parentId) return false;
      // テーマフィルターが設定されている場合は、そのテーマのタスクのみカウント
      if (themeFilter !== null && t.themeId !== themeFilter) return false;
      // カテゴリフィルターが設定されている場合は、そのカテゴリに属するテーマのタスクのみカウント
      if (categoryThemeIds !== null && (!t.themeId || !categoryThemeIds.has(t.themeId))) return false;
      // 今日のタスクのみフィルタリング（createdAtが今日の日付）
      const taskDate = new Date(t.createdAt);
      taskDate.setHours(0, 0, 0, 0);
      return taskDate.getTime() === today.getTime();
    });

    const completed = todayTasks.filter((t) => t.status === 'done').length;
    const total = todayTasks.length;

    return { total, completed };
  }, [tasks, themeFilter, categoryFilter, categoryThemeIds]);

  return {
    filteredTasks,
    statusCounts,
    todayTasksCounts,
  };
}
