/**
 * useSubtaskManagement
 *
 * Manages all subtask interactions: creating, inline-editing, and delegating
 * deletion to useSubtaskDeletion. Composes into a single return value for
 * the task detail page.
 */

import { useState, useCallback } from 'react';
import type { Task, Priority } from '@/types';
import { getLabelsArray } from '@/utils/labels';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import { useSubtaskDeletion } from './useSubtaskDeletion';

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
  // ── Add new subtask ─────────────────────────────────────────────────
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newSubtaskDescription, setNewSubtaskDescription] = useState('');
  const [newSubtaskLabels, setNewSubtaskLabels] = useState('');
  const [newSubtaskEstimatedHours, setNewSubtaskEstimatedHours] = useState('');

  // ── Inline subtask editing ───────────────────────────────────────────
  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('');
  const [editingSubtaskDescription, setEditingSubtaskDescription] =
    useState('');
  const [editingSubtaskPriority, setEditingSubtaskPriority] =
    useState<Priority>('medium');
  const [editingSubtaskLabels, setEditingSubtaskLabels] = useState('');
  const [editingSubtaskEstimatedHours, setEditingSubtaskEstimatedHours] =
    useState('');

  // ── Helpers ──────────────────────────────────────────────────────────
  const refetchTask = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (res.ok) setTask(await res.json());
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
  const toggleAddSubtask = useCallback(() => {
    setIsAddingSubtask((prev) => !prev);
    setNewSubtaskTitle('');
    setNewSubtaskDescription('');
    setNewSubtaskLabels('');
    setNewSubtaskEstimatedHours('');
  }, []);

  const cancelAddSubtask = useCallback(() => {
    setIsAddingSubtask(false);
    setNewSubtaskTitle('');
    setNewSubtaskDescription('');
    setNewSubtaskLabels('');
    setNewSubtaskEstimatedHours('');
  }, []);

  const addSubtask = useCallback(async () => {
    if (!task || !newSubtaskTitle.trim()) return;

    const labelsArray = newSubtaskLabels
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
    const hours = newSubtaskEstimatedHours
      ? parseFloat(newSubtaskEstimatedHours)
      : undefined;

    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newSubtaskTitle.trim(),
          parentId: task.id,
          status: 'todo',
          priority: 'medium',
          ...(newSubtaskDescription.trim() && {
            description: newSubtaskDescription.trim(),
          }),
          ...(labelsArray.length > 0 && {
            labels: JSON.stringify(labelsArray),
          }),
          ...(hours && !isNaN(hours) && { estimatedHours: hours }),
        }),
      });

      if (!res.ok) throw new Error('サブタスクの作成に失敗しました');

      await refetchTask();
      setNewSubtaskTitle('');
      setNewSubtaskDescription('');
      setNewSubtaskLabels('');
      setNewSubtaskEstimatedHours('');
      setIsAddingSubtask(false);
      onTaskUpdated?.();
    } catch (err) {
      logger.error(err);
      alert('サブタスクの作成に失敗しました');
    }
  }, [
    task,
    newSubtaskTitle,
    newSubtaskDescription,
    newSubtaskLabels,
    newSubtaskEstimatedHours,
    refetchTask,
    onTaskUpdated,
  ]);

  // ── Inline editing ────────────────────────────────────────────────────
  const startEditingSubtask = useCallback((subtask: Task) => {
    setEditingSubtaskId(subtask.id);
    setEditingSubtaskTitle(subtask.title);
    setEditingSubtaskDescription(subtask.description || '');
    setEditingSubtaskPriority((subtask.priority as Priority) || 'medium');
    setEditingSubtaskLabels(getLabelsArray(subtask.labels).join(', '));
    setEditingSubtaskEstimatedHours(subtask.estimatedHours?.toString() || '');
  }, []);

  const cancelEditingSubtask = useCallback(() => {
    setEditingSubtaskId(null);
    setEditingSubtaskTitle('');
    setEditingSubtaskDescription('');
    setEditingSubtaskPriority('medium');
    setEditingSubtaskLabels('');
    setEditingSubtaskEstimatedHours('');
  }, []);

  const updateSubtask = useCallback(
    async (
      subtaskId: number,
      data: {
        title?: string;
        description?: string;
        priority?: string;
        labels?: string[];
        estimatedHours?: number | null;
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
        alert('サブタスクの更新に失敗しました');
      }
    },
    [refetchTask],
  );

  const saveSubtaskEdit = useCallback(() => {
    if (editingSubtaskId && editingSubtaskTitle.trim()) {
      const labelArray = editingSubtaskLabels
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);
      updateSubtask(editingSubtaskId, {
        title: editingSubtaskTitle,
        description: editingSubtaskDescription || undefined,
        priority: editingSubtaskPriority,
        labels: labelArray.length > 0 ? labelArray : undefined,
        estimatedHours: editingSubtaskEstimatedHours
          ? parseFloat(editingSubtaskEstimatedHours)
          : null,
      });
    }
  }, [
    editingSubtaskId,
    editingSubtaskTitle,
    editingSubtaskDescription,
    editingSubtaskPriority,
    editingSubtaskLabels,
    editingSubtaskEstimatedHours,
    updateSubtask,
  ]);

  return {
    isAddingSubtask,
    newSubtaskTitle,
    setNewSubtaskTitle,
    newSubtaskDescription,
    setNewSubtaskDescription,
    newSubtaskLabels,
    setNewSubtaskLabels,
    newSubtaskEstimatedHours,
    setNewSubtaskEstimatedHours,
    toggleAddSubtask,
    cancelAddSubtask,
    addSubtask,
    editingSubtaskId,
    editingSubtaskTitle,
    setEditingSubtaskTitle,
    editingSubtaskDescription,
    setEditingSubtaskDescription,
    editingSubtaskPriority,
    setEditingSubtaskPriority,
    editingSubtaskLabels,
    setEditingSubtaskLabels,
    editingSubtaskEstimatedHours,
    setEditingSubtaskEstimatedHours,
    startEditingSubtask,
    cancelEditingSubtask,
    saveSubtaskEdit,
    // Deletion state and handlers from useSubtaskDeletion
    ...deletion,
  };
}
