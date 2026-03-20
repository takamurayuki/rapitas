/**
 * useTaskEdit
 *
 * Manages edit-mode state and save logic for the main task fields
 * (title, description, status, labels, estimated hours, priority).
 * Does not handle subtask editing or task deletion.
 */

import { useState, useCallback } from 'react';
import type { Task, Priority } from '@/types';
import { getLabelsArray } from '@/utils/labels';
import { API_BASE_URL } from '@/utils/api';
import { clearApiCache } from '@/lib/api-client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useTaskEdit');
const API_BASE = API_BASE_URL;

interface UseTaskEditParams {
  task: Task | null;
  setTask: React.Dispatch<React.SetStateAction<Task | null>>;
}

/**
 * Provides editing state and handlers for the main task form.
 *
 * @param params - task and setTask / タスクと状態更新関数
 * @returns edit state fields, setters, and action callbacks
 */
export function useTaskEdit({ task, setTask }: UseTaskEditParams) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editLabels, setEditLabels] = useState('');
  const [editLabelIds, setEditLabelIds] = useState<number[]>([]);
  const [editEstimatedHours, setEditEstimatedHours] = useState('');
  const [editPriority, setEditPriority] = useState<Priority>('medium');

  const startEditing = useCallback(() => {
    if (!task) return;
    setEditTitle(task.title);
    setEditDescription(task.description || '');
    setEditStatus(task.status);
    setEditLabels(getLabelsArray(task.labels).join(', '));
    setEditLabelIds(task.taskLabels?.map((tl) => tl.labelId) || []);
    setEditEstimatedHours(task.estimatedHours?.toString() || '');
    setEditPriority((task.priority as Priority) || 'medium');
    setIsEditing(true);
  }, [task]);

  const cancelEditing = useCallback(() => setIsEditing(false), []);

  const saveTask = useCallback(async () => {
    if (!task || !editTitle.trim()) return;

    try {
      const labelArray = editLabels
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);

      const res = await fetch(`${API_BASE}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription || undefined,
          status: editStatus,
          priority: editPriority,
          labels: labelArray.length > 0 ? labelArray : undefined,
          labelIds: editLabelIds,
          estimatedHours: editEstimatedHours
            ? parseFloat(editEstimatedHours)
            : undefined,
        }),
      });

      if (!res.ok) throw new Error('更新に失敗しました');
      const updated = await res.json();
      // NOTE: Invalidate apiFetch cache so subsequent fetches get fresh data
      clearApiCache(`/tasks/${task.id}`);
      setTask(updated);
      setIsEditing(false);
    } catch (err) {
      logger.error(err);
      alert('タスクの更新に失敗しました');
    }
  }, [
    task,
    editTitle,
    editDescription,
    editStatus,
    editPriority,
    editLabels,
    editLabelIds,
    editEstimatedHours,
    setTask,
  ]);

  return {
    isEditing,
    editTitle,
    setEditTitle,
    editDescription,
    setEditDescription,
    editStatus,
    setEditStatus,
    editLabels,
    setEditLabels,
    editLabelIds,
    setEditLabelIds,
    editEstimatedHours,
    setEditEstimatedHours,
    editPriority,
    setEditPriority,
    startEditing,
    cancelEditing,
    saveTask,
  };
}
