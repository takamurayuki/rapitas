'use client';
// useKanbanFilters

import { useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { Label } from '@/types';

type Priority = 'low' | 'medium' | 'high' | 'urgent';

interface FilterableTask {
  id: number;
  title: string;
  description?: string | null;
  status: string;
  priority?: Priority | null;
  parentId?: number | null;
  createdAt: string;
  dueDate?: string | null;
  themeId?: number | null;
  taskLabels?: Array<{ label?: { id: number } | null }> | null;
  labels?: unknown;
}

interface UseKanbanFiltersOptions {
  tasks: FilterableTask[];
  weekStart: Date;
  weekEnd: Date;
}

/**
 * Manages filter state and derives the visible task list for the Kanban board.
 * The text search query is owned by the URL `?q=` param so the header search bar
 * can drive it directly; priority and label filters remain in local state.
 *
 * @param tasks - Full unfiltered task list from the cache store
 * @param weekStart - Start of the visible week range
 * @param weekEnd - End of the visible week range
 * @returns Filter state, setters, derived filtered tasks, and label list
 */
export function useKanbanFilters({ tasks, weekStart, weekEnd }: UseKanbanFiltersOptions) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // NOTE: searchQuery is read from the URL ?q= param so the header search bar
  // can control kanban filtering without a shared context.
  const searchQuery = searchParams.get('q') ?? '';

  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [selectedThemeId, setSelectedThemeId] = useState<number | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Week filter: show tasks created or due within the selected week.
      // In-progress tasks are subject to the same range — no special bypass.
      const taskCreatedAt = new Date(task.createdAt);
      const taskDueDate = task.dueDate ? new Date(task.dueDate) : null;

      const isCreatedInWeek = taskCreatedAt >= weekStart && taskCreatedAt <= weekEnd;
      const isDueInWeek =
        taskDueDate !== null && taskDueDate >= weekStart && taskDueDate <= weekEnd;

      if (!isCreatedInWeek && !isDueInWeek) return false;

      // Theme filter
      if (selectedThemeId !== null && task.themeId !== selectedThemeId) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(query);
        const matchesDescription = task.description?.toLowerCase().includes(query);
        if (!matchesTitle && !matchesDescription) return false;
      }

      // Priority filter
      if (selectedPriorities.length > 0) {
        if (!task.priority || !selectedPriorities.includes(task.priority)) return false;
      }

      // Label filter
      if (selectedLabelIds.length > 0) {
        const taskLabelIds =
          task.taskLabels?.map((tl) => tl.label?.id).filter((id): id is number => id != null) || [];
        const hasMatchingLabel = selectedLabelIds.some((id) => taskLabelIds.includes(id));
        if (!hasMatchingLabel) return false;
      }

      return true;
    });
  }, [
    tasks,
    searchQuery,
    selectedPriorities,
    selectedLabelIds,
    selectedThemeId,
    weekStart,
    weekEnd,
  ]);

  const hasActiveFilters =
    !!searchQuery ||
    selectedPriorities.length > 0 ||
    selectedLabelIds.length > 0 ||
    selectedThemeId !== null;

  const clearFilters = () => {
    setSelectedPriorities([]);
    setSelectedLabelIds([]);
    setSelectedThemeId(null);
    // Also clear the ?q= param so the header search box empties.
    const params = new URLSearchParams(searchParams.toString());
    params.delete('q');
    const newUrl = params.toString() ? `/kanban?${params}` : '/kanban';
    router.replace(newUrl, { scroll: false });
  };

  const togglePriority = (priority: Priority) => {
    setSelectedPriorities((prev) =>
      prev.includes(priority) ? prev.filter((p) => p !== priority) : [...prev, priority],
    );
  };

  const toggleLabel = (labelId: number) => {
    setSelectedLabelIds((prev) =>
      prev.includes(labelId) ? prev.filter((id) => id !== labelId) : [...prev, labelId],
    );
  };

  return {
    searchQuery,
    selectedPriorities,
    selectedLabelIds,
    selectedThemeId,
    setSelectedThemeId,
    labels,
    setLabels,
    filteredTasks,
    hasActiveFilters,
    clearFilters,
    togglePriority,
    toggleLabel,
  };
}
