/**
 * useSubtaskDeletion
 *
 * Handles subtask deletion: single, selected-batch, and all-at-once.
 * Also owns the multi-select UI state (selection mode, selected IDs,
 * delete-confirm dialog).
 */

import { useState, useCallback } from 'react';
import type { Task } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

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
export function useSubtaskDeletion({
  task,
  onRefetch,
  onTaskUpdated,
}: UseSubtaskDeletionParams) {
  const [isSubtaskSelectionMode, setIsSubtaskSelectionMode] = useState(false);
  const [selectedSubtaskIds, setSelectedSubtaskIds] = useState<Set<number>>(
    new Set(),
  );
  const [showSubtaskDeleteConfirm, setShowSubtaskDeleteConfirm] = useState<
    'all' | 'selected' | null
  >(null);

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
        alert('サブタスクの削除に失敗しました');
      }
    },
    [onRefetch, onTaskUpdated],
  );

  const deleteAllSubtasks = useCallback(async () => {
    if (!task) return;

    try {
      const res = await fetch(`${API_BASE}/tasks/${task.id}/subtasks`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('削除に失敗しました');
      const result = await res.json();
      logger.debug(
        `[TaskDetail] Deleted all subtasks: ${result.deletedCount} items`,
      );
      await onRefetch();
      onTaskUpdated?.();
    } catch (err) {
      logger.error(err);
      alert('サブタスクの削除に失敗しました');
    }
  }, [task, onRefetch, onTaskUpdated]);

  const deleteSelectedSubtasks = useCallback(
    async (subtaskIds: number[]) => {
      if (!task || subtaskIds.length === 0) return;

      try {
        const res = await fetch(
          `${API_BASE}/tasks/${task.id}/subtasks/delete-selected`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subtaskIds }),
          },
        );
        if (!res.ok) throw new Error('削除に失敗しました');
        const result = await res.json();
        logger.debug(
          `[TaskDetail] Deleted selected subtasks: ${result.deletedCount} items`,
        );
        await onRefetch();
        onTaskUpdated?.();
      } catch (err) {
        logger.error(err);
        alert('サブタスクの削除に失敗しました');
      }
    },
    [task, onRefetch, onTaskUpdated],
  );

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

  const handleDeleteSelectedSubtasks = useCallback(async () => {
    if (selectedSubtaskIds.size > 0) {
      await deleteSelectedSubtasks(Array.from(selectedSubtaskIds));
      setSelectedSubtaskIds(new Set());
      setIsSubtaskSelectionMode(false);
      setShowSubtaskDeleteConfirm(null);
    }
  }, [selectedSubtaskIds, deleteSelectedSubtasks]);

  const handleDeleteAllSubtasks = useCallback(async () => {
    await deleteAllSubtasks();
    setShowSubtaskDeleteConfirm(null);
  }, [deleteAllSubtasks]);

  return {
    isSubtaskSelectionMode,
    selectedSubtaskIds,
    showSubtaskDeleteConfirm,
    setShowSubtaskDeleteConfirm,
    deleteSubtask,
    toggleSubtaskSelectionMode,
    toggleSubtaskSelection,
    selectAllSubtasks,
    deselectAllSubtasks,
    handleDeleteSelectedSubtasks,
    handleDeleteAllSubtasks,
  };
}
