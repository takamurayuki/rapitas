/**
 * useSubtaskDeletion
 *
 * Handles subtask deletion: single and selected-batch (guarded by the shared
 * confirm modal). Also owns the multi-select UI state (selection mode,
 * selected IDs).
 */

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { Task } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';

const logger = createLogger('useSubtaskDeletion');
const API_BASE = API_BASE_URL;

interface UseSubtaskDeletionParams {
  task: Task | null;
  onRefetch: () => Promise<void>;
  onTaskUpdated?: () => void;
}

/**
 * Returns deletion state and handlers for individual, selected, and all subtasks.
 *
 * @param params - task, refetch callback, and optional update callback
 * @returns selection state, confirm dialog state, and delete action callbacks
 */
export function useSubtaskDeletion({ task, onRefetch, onTaskUpdated }: UseSubtaskDeletionParams) {
  const t = useTranslations('task');
  const { showToast } = useToast();
  const confirm = useConfirmDialog();
  const [isSubtaskSelectionMode, setIsSubtaskSelectionMode] = useState(false);
  const [selectedSubtaskIds, setSelectedSubtaskIds] = useState<Set<number>>(new Set());

  const deleteSubtask = useCallback(
    async (subtaskId: number) => {
      try {
        const res = await fetch(`${API_BASE}/tasks/${subtaskId}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('削除に失敗しました');
        await onRefetch();
        onTaskUpdated?.();
      } catch (err) {
        logger.error(err);
        showToast(t('subtaskManagement.deleteFailed'), 'error');
      }
    },
    [onRefetch, onTaskUpdated, showToast, t],
  );

  const deleteSelectedSubtasks = useCallback(
    async (subtaskIds: number[]) => {
      if (!task || subtaskIds.length === 0) return;

      try {
        const res = await fetch(`${API_BASE}/tasks/${task.id}/subtasks/delete-selected`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subtaskIds }),
        });
        if (!res.ok) throw new Error('削除に失敗しました');
        const result = await res.json();
        logger.debug(`[TaskDetail] Deleted selected subtasks: ${result.deletedCount} items`);
        await onRefetch();
        onTaskUpdated?.();
      } catch (err) {
        logger.error(err);
        showToast(t('subtaskManagement.deleteFailed'), 'error');
      }
    },
    [task, onRefetch, onTaskUpdated, showToast, t],
  );

  // NOTE: bulkUpdateSubtaskStatus was removed 2026-07-14 — bulk status changes
  // proved rare for subtasks; restore from HomeToolbar's pattern if needed.

  const toggleSubtaskSelectionMode = useCallback(() => {
    if (isSubtaskSelectionMode) {
      setSelectedSubtaskIds(new Set());
    }
    setIsSubtaskSelectionMode((prev) => !prev);
  }, [isSubtaskSelectionMode]);

  const toggleSubtaskSelection = useCallback((subtaskId: number) => {
    setSelectedSubtaskIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(subtaskId)) {
        newSet.delete(subtaskId);
      } else {
        newSet.add(subtaskId);
      }
      return newSet;
    });
  }, []);

  const selectAllSubtasks = useCallback(() => {
    if (task?.subtasks) {
      setSelectedSubtaskIds(new Set(task.subtasks.map((s) => s.id)));
    }
  }, [task?.subtasks]);

  const deselectAllSubtasks = useCallback(() => {
    setSelectedSubtaskIds(new Set());
  }, []);

  /**
   * Confirms via the shared modal (same one the task list uses, with a
   * subtask-specific message), then deletes the selected subtasks and exits
   * selection mode.
   */
  const handleDeleteSelectedSubtasks = useCallback(async () => {
    if (selectedSubtaskIds.size === 0) return;
    if (
      !(await confirm({
        message: t('subtaskBulkDeleteConfirm', { count: selectedSubtaskIds.size }),
        variant: 'destructive',
      }))
    )
      return;
    await deleteSelectedSubtasks(Array.from(selectedSubtaskIds));
    setSelectedSubtaskIds(new Set());
    setIsSubtaskSelectionMode(false);
  }, [selectedSubtaskIds, deleteSelectedSubtasks, confirm, t]);

  return {
    isSubtaskSelectionMode,
    selectedSubtaskIds,
    deleteSubtask,
    toggleSubtaskSelectionMode,
    toggleSubtaskSelection,
    selectAllSubtasks,
    deselectAllSubtasks,
    handleDeleteSelectedSubtasks,
  };
}
