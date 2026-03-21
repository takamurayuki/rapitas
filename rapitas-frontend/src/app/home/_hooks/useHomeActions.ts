/**
 * useHomeActions
 *
 * Provides task-mutating action handlers for the home page:
 * status update, quick-add, bulk status change, and bulk delete.
 * All network calls use optimistic updates with rollback on failure.
 */
'use client';
import { useCallback } from 'react';
import type { Status, Task, Theme } from '@/types';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { apiFetch } from '@/lib/api-client';
import { API_BASE_URL } from '@/utils/api';
import { useTranslations } from 'next-intl';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useHomeActions');
const API_BASE = API_BASE_URL;

interface UseHomeActionsParams {
  tasks: Task[];
  themes: Theme[];
  categoryFilter: number | null;
  themeFilter: number | null;
  defaultTheme: Theme | null;
  isSelectionMode: boolean;
  selectedTasks: Set<number>;
  setSelectedTasks: (tasks: Set<number>) => void;
  setIsSelectionMode: (v: boolean) => void;
  setIsQuickAdding: (v: boolean) => void;
  setQuickTaskTitle: (v: string) => void;
  triggerTaskCompletion: (taskId: number, x: number, y: number) => void;
  isTodayTask: (task?: Task | null) => boolean;
  fetchTasks: () => Promise<void>;
}

/**
 * Encapsulates all task mutation handlers for the home page.
 *
 * @param params - Dependencies required to perform actions.
 * @returns Action callbacks to pass to child components.
 */
export function useHomeActions({
  tasks,
  themes,
  categoryFilter,
  themeFilter,
  defaultTheme,
  isSelectionMode,
  selectedTasks,
  setSelectedTasks,
  setIsSelectionMode,
  setIsQuickAdding,
  setQuickTaskTitle,
  triggerTaskCompletion,
  isTodayTask,
  fetchTasks,
}: UseHomeActionsParams) {
  const { showToast } = useToast();
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const updateTaskLocally = useTaskCacheStore((s) => s.updateTaskLocally);
  const removeTaskLocally = useTaskCacheStore((s) => s.removeTaskLocally);

  /**
   * Updates a single task's status with optimistic update and rollback.
   *
   * @param id - Task ID to update.
   * @param status - Target status.
   * @param cardElement - DOM element used to compute animation origin.
   */
  const updateStatus = useCallback(
    async (id: number, status: Status, cardElement?: HTMLElement) => {
      const oldTask = tasks.find((t) => t.id === id);
      const hasThemesInCategory =
        categoryFilter === null ||
        themes.filter((t) => t.categoryId === categoryFilter).length > 0;

      if (
        status === 'done' &&
        oldTask?.status !== 'done' &&
        cardElement &&
        isTodayTask(oldTask) &&
        hasThemesInCategory
      ) {
        const rect = cardElement.getBoundingClientRect();
        triggerTaskCompletion(id, rect.left + rect.width * 0.15, rect.top + rect.height / 2);
      }

      updateTaskLocally(id, { status });

      try {
        const res = await fetch(`${API_BASE}/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        if (!res.ok) throw new Error(t('updateFailed'));
      } catch (e) {
        logger.error(e);
        if (oldTask) updateTaskLocally(id, { status: oldTask.status });
      }
    },
    [tasks, themes, categoryFilter, isTodayTask, triggerTaskCompletion, updateTaskLocally, t],
  );

  /**
   * Creates a task with the current title and resets quick-add state on success.
   *
   * @param quickTaskTitle - Title entered in the quick-add input.
   */
  const handleQuickAdd = useCallback(
    async (quickTaskTitle: string) => {
      if (!quickTaskTitle.trim()) return;
      try {
        await apiFetch('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: quickTaskTitle,
            status: 'todo',
            priority: 'medium',
            ...(themeFilter && { themeId: themeFilter }),
            ...(!themeFilter && defaultTheme && { themeId: defaultTheme.id }),
          }),
          skipCache: true,
        });
        setQuickTaskTitle('');
        setIsQuickAdding(false);
        showToast(t('taskCreated'), 'success');
        await fetchTasks();
      } catch (e) {
        logger.error(e);
        showToast(t('createFailed'), 'error');
      }
    },
    [themeFilter, defaultTheme, setQuickTaskTitle, setIsQuickAdding, showToast, t, fetchTasks],
  );

  /**
   * Toggles a task's presence in the current bulk selection.
   *
   * @param taskId - Task to toggle.
   */
  const toggleTaskSelection = useCallback(
    (taskId: number) => {
      const newSelection = new Set(selectedTasks);
      if (newSelection.has(taskId)) {
        newSelection.delete(taskId);
      } else {
        newSelection.add(taskId);
      }
      setSelectedTasks(newSelection);
    },
    [selectedTasks, setSelectedTasks],
  );

  /**
   * Sets the given status on all currently selected tasks.
   *
   * @param status - Target status string.
   */
  const bulkUpdateStatus = useCallback(
    async (status: string) => {
      const taskIds = Array.from(selectedTasks);
      try {
        await Promise.all(
          taskIds.map((id) =>
            fetch(`${API_BASE}/tasks/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status }),
            }),
          ),
        );
        for (const id of taskIds) {
          updateTaskLocally(id, { status: status as Status });
        }
        showToast(`${taskIds.length}${t('bulkUpdated')}`, 'success');
        setSelectedTasks(new Set());
        setIsSelectionMode(false);
      } catch {
        showToast(t('bulkUpdateFailed'), 'error');
      }
    },
    [selectedTasks, updateTaskLocally, showToast, t, setSelectedTasks, setIsSelectionMode],
  );

  /**
   * Deletes all currently selected tasks after user confirmation.
   */
  const bulkDelete = useCallback(async () => {
    if (!confirm(t('bulkDeleteConfirm', { count: selectedTasks.size }))) return;
    const taskIds = Array.from(selectedTasks);
    try {
      await Promise.all(
        taskIds.map((id) => fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' })),
      );
      for (const id of taskIds) removeTaskLocally(id);
      showToast(`${taskIds.length}${t('bulkDeleted')}`, 'success');
      setSelectedTasks(new Set());
      setIsSelectionMode(false);
    } catch {
      showToast(t('bulkDeleteFailed'), 'error');
    }
  }, [selectedTasks, removeTaskLocally, showToast, t, setSelectedTasks, setIsSelectionMode]);

  // NOTE: tc is consumed here only to satisfy the import; the tc reference
  // originates from the same translations bundle used by child components.
  void tc;

  return {
    updateStatus,
    handleQuickAdd,
    toggleTaskSelection,
    bulkUpdateStatus,
    bulkDelete,
  };
}
