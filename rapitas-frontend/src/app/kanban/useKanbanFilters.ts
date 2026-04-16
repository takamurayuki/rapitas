'use client';
// useKanbanFilters

import { useState, useMemo } from 'react';
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
 *
 * @param tasks - Full unfiltered task list from the cache store
 * @param weekStart - Start of the visible week range
 * @param weekEnd - End of the visible week range
 * @returns Filter state, setters, derived filtered tasks, and label list
 */
export function useKanbanFilters({
  tasks,
  weekStart,
  weekEnd,
}: UseKanbanFiltersOptions) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPriorities, setSelectedPriorities] = useState<Priority[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [labels, setLabels] = useState<Label[]>([]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // Week filter:
      // 1. In-progress tasks are always shown
      // 2. Tasks with due date within current week
      // 3. Tasks created within current week
      const taskCreatedAt = new Date(task.createdAt);
      const taskDueDate = task.dueDate ? new Date(task.dueDate) : null;

      const isInProgress = task.status === 'in-progress';
      const isCreatedInWeek =
        taskCreatedAt >= weekStart && taskCreatedAt <= weekEnd;
      const isDueInWeek =
        taskDueDate && taskDueDate >= weekStart && taskDueDate <= weekEnd;

      const isInWeek = isInProgress || isCreatedInWeek || isDueInWeek;
      if (!isInWeek) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(query);
        const matchesDescription = task.description
          ?.toLowerCase()
          .includes(query);
        if (!matchesTitle && !matchesDescription) return false;
      }

      // Priority filter
      if (selectedPriorities.length > 0) {
        if (!task.priority || !selectedPriorities.includes(task.priority))
          return false;
      }

      // Label filter
      if (selectedLabelIds.length > 0) {
        const taskLabelIds =
          task.taskLabels
            ?.map((tl) => tl.label?.id)
            .filter((id): id is number => id != null) || [];
        const hasMatchingLabel = selectedLabelIds.some((id) =>
          taskLabelIds.includes(id),
        );
        if (!hasMatchingLabel) return false;
      }

      return true;
    });
  }, [
    tasks,
    searchQuery,
    selectedPriorities,
    selectedLabelIds,
    weekStart,
    weekEnd,
  ]);

  const hasActiveFilters =
    !!searchQuery ||
    selectedPriorities.length > 0 ||
    selectedLabelIds.length > 0;

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedPriorities([]);
    setSelectedLabelIds([]);
  };

  const togglePriority = (priority: Priority) => {
    setSelectedPriorities((prev) =>
      prev.includes(priority)
        ? prev.filter((p) => p !== priority)
        : [...prev, priority],
    );
  };

  const toggleLabel = (labelId: number) => {
    setSelectedLabelIds((prev) =>
      prev.includes(labelId)
        ? prev.filter((id) => id !== labelId)
        : [...prev, labelId],
    );
  };

  return {
    searchQuery,
    setSearchQuery,
    selectedPriorities,
    selectedLabelIds,
    labels,
    setLabels,
    filteredTasks,
    hasActiveFilters,
    clearFilters,
    togglePriority,
    toggleLabel,
  };
}
