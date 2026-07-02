'use client';
// useHomeActions
import { useCallback } from 'react';
import type { Status, Task, Theme } from '@/types';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { API_BASE_URL } from '@/utils/api';
import { useTranslations } from 'next-intl';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useHomeActions');
const API_BASE = API_BASE_URL;

interface UseHomeActionsParams {
  tasks: Task[];
  themes: Theme[];
  categoryFilter: number | null;
  isSelectionMode: boolean;
  selectedTasks: Set<number>;
  setSelectedTasks: (tasks: Set<number>) => void;
  setIsSelectionMode: (v: boolean) => void;
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
  isSelectionMode,
  selectedTasks,
  setSelectedTasks,
  setIsSelectionMode,
  triggerTaskCompletion,
  isTodayTask,
  fetchTasks: _fetchTasks,
}: UseHomeActionsParams) {
  const { showToast } = useToast();
  const confirm = useConfirmDialog();
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
        categoryFilter === null || themes.filter((t) => t.categoryId === categoryFilter).length > 0;

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
   * Protected (locked) tasks are skipped and remain in the task list with a partial-failure notice.
   */
  const bulkDelete = useCallback(async () => {
    if (
      !(await confirm({
        message: t('bulkDeleteConfirm', { count: selectedTasks.size }),
        variant: 'destructive',
      }))
    )
      return;
    const taskIds = Array.from(selectedTasks);

    const protectedIds = taskIds.filter((id) => tasks.find((task) => task.id === id)?.isProtected);
    const deletableIds = taskIds.filter((id) => !tasks.find((task) => task.id === id)?.isProtected);

    try {
      await Promise.all(
        deletableIds.map((id) => fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' })),
      );
      for (const id of deletableIds) removeTaskLocally(id);

      if (protectedIds.length > 0) {
        showToast(
          t('bulkDeletePartialSkipped', { total: taskIds.length, skipped: protectedIds.length }),
          'warning',
        );
        setSelectedTasks(new Set(protectedIds));
      } else {
        showToast(`${deletableIds.length}${t('bulkDeleted')}`, 'success');
        setSelectedTasks(new Set());
        setIsSelectionMode(false);
      }
    } catch {
      showToast(t('bulkDeleteFailed'), 'error');
    }
  }, [
    selectedTasks,
    tasks,
    removeTaskLocally,
    showToast,
    t,
    setSelectedTasks,
    setIsSelectionMode,
    confirm,
  ]);

  // NOTE: tc and isSelectionMode are consumed here only to satisfy the interface contract;
  // they originate from callers that pass them for symmetry with setIsSelectionMode.
  void tc;
  void isSelectionMode;

  return {
    updateStatus,
    toggleTaskSelection,
    bulkUpdateStatus,
    bulkDelete,
  };
}
