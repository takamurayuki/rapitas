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
  // Compute set of theme IDs belonging to selected category
  const categoryThemeIds = useMemo(() => {
    if (categoryFilter === null) return null;
    return new Set(themes.filter((t) => t.categoryId === categoryFilter).map((t) => t.id));
  }, [categoryFilter, themes]);

  // Centralize filtering logic in single location
  const { filteredTasks, statusCounts } = useMemo(() => {
    const counts: Record<string, number> = {
      all: 0,
      todo: 0,
      'in-progress': 0,
      done: 0,
    };

    const filtered = tasks.filter((t) => {
      if (t.parentId) return false;

      // Filter conditions
      const statusMatch = filter === 'all' || t.status === filter;
      const themeMatch = themeFilter === null || t.themeId === themeFilter;
      const categoryMatch =
        themeFilter !== null || // Skip category filter when theme is selected
        categoryThemeIds === null ||
        (t.themeId && categoryThemeIds.has(t.themeId));
      const priorityMatch = priorityFilter === null || t.priority === priorityFilter;
      const searchMatch = !searchQuery || t.title.toLowerCase().includes(searchQuery.toLowerCase());

      // Check if all conditions match
      const matches = statusMatch && themeMatch && categoryMatch && priorityMatch && searchMatch;

      // Update counts (theme and category conditions always apply)
      if (themeMatch && categoryMatch && priorityMatch && searchMatch) {
        counts.all++;
        if (t.status === 'todo') counts.todo++;
        else if (t.status === 'in-progress') counts['in-progress']++;
        else if (t.status === 'done') counts.done++;
      }

      return matches;
    });

    return { filteredTasks: filtered, statusCounts: counts };
  }, [tasks, filter, categoryFilter, themeFilter, priorityFilter, searchQuery, categoryThemeIds]);

  // Count today's tasks (filtered by selected theme)
  const todayTasksCounts = useMemo(() => {
    // Don't count today's tasks if category has no themes
    if (categoryFilter !== null && categoryThemeIds && categoryThemeIds.size === 0) {
      return { total: 0, completed: 0 };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayTasks = tasks.filter((t) => {
      if (t.parentId) return false;
      // When theme filter is set, only count tasks from that theme
      if (themeFilter !== null && t.themeId !== themeFilter) return false;
      // When category filter is set, only count tasks from themes in that category
      if (categoryThemeIds !== null && (!t.themeId || !categoryThemeIds.has(t.themeId)))
        return false;
      // Filter to only tasks created today (createdAt is today's date)
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
