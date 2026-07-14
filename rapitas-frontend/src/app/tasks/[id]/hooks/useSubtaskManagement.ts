/**
 * useSubtaskManagement
 *
 * Manages all subtask interactions: creating, inline-editing, and delegating
 * deletion to useSubtaskDeletion. Composes into a single return value for
 * the task detail page.
 */

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { Task, Priority } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { useSubtaskDeletion } from './useSubtaskDeletion';
import { useToast } from '@/components/ui/toast/ToastContainer';

const logger = createLogger('useSubtaskManagement');
const API_BASE = API_BASE_URL;

interface UseSubtaskManagementParams {
  task: Task | null;
  resolvedTaskId: string | null | undefined;
  setTask: React.Dispatch<React.SetStateAction<Task | null>>;
  onTaskUpdated?: () => void;
}

/**
 * Returns state and handlers for all subtask operations (create, edit, delete).
 *
 * @param params - task context and optional update callback / タスクコンテキストと更新コールバック
 * @returns subtask form state, edit state, selection state, and action callbacks
 */
export function useSubtaskManagement({
  task,
  resolvedTaskId,
  setTask,
  onTaskUpdated,
}: UseSubtaskManagementParams) {
  const t = useTranslations('task');
  const { showToast } = useToast();
  // ── Add new subtask ─────────────────────────────────────────────────
  // NOTE: No label state — subtask labels are intentionally unsupported;
  // labels are configured on the parent task only.
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newSubtaskDescription, setNewSubtaskDescription] = useState('');
  const [newSubtaskPriority, setNewSubtaskPriority] = useState<Priority>('medium');
  const [newSubtaskEstimatedHours, setNewSubtaskEstimatedHours] = useState('');
  const [newSubtaskActualHours, setNewSubtaskActualHours] = useState('');

  // ── Inline subtask editing ───────────────────────────────────────────
  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('');
  const [editingSubtaskDescription, setEditingSubtaskDescription] = useState('');
  const [editingSubtaskPriority, setEditingSubtaskPriority] = useState<Priority>('medium');
  const [editingSubtaskEstimatedHours, setEditingSubtaskEstimatedHours] = useState('');
  const [editingSubtaskActualHours, setEditingSubtaskActualHours] = useState('');

  // ── Helpers ──────────────────────────────────────────────────────────
  const refetchTask = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (res.ok) {
        const fresh = (await res.json()) as Task;
        setTask(fresh);
        // Mirror the fresh subtasks into the SHARED list cache so the parent's
        // card reflects an added/removed subtask without a reload (no-op when
        // the list isn't loaded). The list filters out parentId tasks, so the
        // only way it surfaces a new subtask is via the parent's subtasks array.
        const numericId = parseInt(resolvedTaskId ?? '', 10);
        if (!Number.isNaN(numericId)) {
          useTaskCacheStore.getState().updateTaskLocally(numericId, fresh);
        }
      }
    } catch (err) {
      logger.error('Failed to refetch task after subtask change:', err);
    }
  }, [resolvedTaskId, setTask]);

  // ── Deletion (delegated) ─────────────────────────────────────────────
  const deletion = useSubtaskDeletion({
    task,
    onRefetch: refetchTask,
    onTaskUpdated,
  });

  // ── Add subtask ──────────────────────────────────────────────────────
  const addSubtask = useCallback(async () => {
    if (!task || !newSubtaskTitle.trim()) return;

    const hours = newSubtaskEstimatedHours ? parseFloat(newSubtaskEstimatedHours) : undefined;
    const actual = newSubtaskActualHours ? parseFloat(newSubtaskActualHours) : undefined;

    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newSubtaskTitle.trim(),
          parentId: task.id,
          status: 'todo',
          priority: newSubtaskPriority,
          ...(newSubtaskDescription.trim() && {
            description: newSubtaskDescription.trim(),
          }),
          ...(hours && !isNaN(hours) && { estimatedHours: hours }),
          ...(actual && !isNaN(actual) && { actualHours: actual }),
        }),
      });

      if (!res.ok) throw new Error('サブタスクの作成に失敗しました');

      await refetchTask();
      setNewSubtaskTitle('');
      setNewSubtaskDescription('');
      setNewSubtaskPriority('medium');
      setNewSubtaskEstimatedHours('');
      setNewSubtaskActualHours('');
      onTaskUpdated?.();
    } catch (err) {
      logger.error(err);
      showToast(t('subtaskManagement.createFailed'), 'error');
    }
  }, [
    task,
    newSubtaskTitle,
    newSubtaskDescription,
    newSubtaskPriority,
    newSubtaskEstimatedHours,
    newSubtaskActualHours,
    refetchTask,
    onTaskUpdated,
    showToast,
    t,
  ]);

  // ── Inline editing ────────────────────────────────────────────────────
  const startEditingSubtask = useCallback((subtask: Task) => {
    setEditingSubtaskId(subtask.id);
    setEditingSubtaskTitle(subtask.title);
    setEditingSubtaskDescription(subtask.description || '');
    setEditingSubtaskPriority((subtask.priority as Priority) || 'medium');
    setEditingSubtaskEstimatedHours(subtask.estimatedHours?.toString() || '');
    setEditingSubtaskActualHours(subtask.actualHours?.toString() || '');
  }, []);

  const cancelEditingSubtask = useCallback(() => {
    setEditingSubtaskId(null);
    setEditingSubtaskTitle('');
    setEditingSubtaskDescription('');
    setEditingSubtaskPriority('medium');
    setEditingSubtaskEstimatedHours('');
    setEditingSubtaskActualHours('');
  }, []);

  const updateSubtask = useCallback(
    async (
      subtaskId: number,
      data: {
        title?: string;
        description?: string;
        priority?: string;
        estimatedHours?: number | null;
        actualHours?: number | null;
      },
    ) => {
      try {
        const res = await fetch(`${API_BASE}/tasks/${subtaskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('サブタスクの更新に失敗しました');

        await refetchTask();
        setEditingSubtaskId(null);
        setEditingSubtaskTitle('');
        setEditingSubtaskDescription('');
      } catch (err) {
        logger.error(err);
        showToast(t('subtaskManagement.updateFailed'), 'error');
      }
    },
    [refetchTask, showToast, t],
  );

  const saveSubtaskEdit = useCallback(() => {
    if (editingSubtaskId && editingSubtaskTitle.trim()) {
      updateSubtask(editingSubtaskId, {
        title: editingSubtaskTitle,
        description: editingSubtaskDescription || undefined,
        priority: editingSubtaskPriority,
        estimatedHours: editingSubtaskEstimatedHours
          ? parseFloat(editingSubtaskEstimatedHours)
          : null,
        actualHours: editingSubtaskActualHours ? parseFloat(editingSubtaskActualHours) : null,
      });
    }
  }, [
    editingSubtaskId,
    editingSubtaskTitle,
    editingSubtaskDescription,
    editingSubtaskPriority,
    editingSubtaskEstimatedHours,
    editingSubtaskActualHours,
    updateSubtask,
  ]);

  return {
    newSubtaskTitle,
    setNewSubtaskTitle,
    newSubtaskDescription,
    setNewSubtaskDescription,
    newSubtaskPriority,
    setNewSubtaskPriority,
    newSubtaskEstimatedHours,
    setNewSubtaskEstimatedHours,
    newSubtaskActualHours,
    setNewSubtaskActualHours,
    addSubtask,
    editingSubtaskId,
    editingSubtaskTitle,
    setEditingSubtaskTitle,
    editingSubtaskDescription,
    setEditingSubtaskDescription,
    editingSubtaskPriority,
    setEditingSubtaskPriority,
    editingSubtaskEstimatedHours,
    setEditingSubtaskEstimatedHours,
    editingSubtaskActualHours,
    setEditingSubtaskActualHours,
    startEditingSubtask,
    cancelEditingSubtask,
    saveSubtaskEdit,
    // Deletion state and handlers from useSubtaskDeletion
    ...deletion,
  };
}
