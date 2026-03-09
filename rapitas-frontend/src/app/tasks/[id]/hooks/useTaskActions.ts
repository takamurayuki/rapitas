import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Task, Priority } from '@/types';
import { getLabelsArray } from '@/utils/labels';
import { getTaskDetailPath } from '@/utils/tauri';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useTaskActions');
const API_BASE = API_BASE_URL;

export interface UseTaskActionsParams {
  task: Task | null;
  resolvedTaskId: string | null | undefined;
  setTask: React.Dispatch<React.SetStateAction<Task | null>>;
  onTaskUpdated?: () => void;
  isThisTaskTimer: boolean;
  pomodoroState: { isTimerRunning: boolean };
  stopTimer: () => void;
  setShowPomodoroModal: (show: boolean) => void;
  setShowCompleteOverlay: (show: boolean) => void;
}

export function useTaskActions({
  task,
  resolvedTaskId,
  setTask,
  onTaskUpdated,
  isThisTaskTimer,
  pomodoroState,
  stopTimer,
  setShowPomodoroModal,
  setShowCompleteOverlay,
}: UseTaskActionsParams) {
  const router = useRouter();

  // --- Edit form state ---
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editLabels, setEditLabels] = useState('');
  const [editLabelIds, setEditLabelIds] = useState<number[]>([]);
  const [editEstimatedHours, setEditEstimatedHours] = useState('');
  const [editPriority, setEditPriority] = useState<Priority>('medium');

  // --- Subtask editing state ---
  const [editingSubtaskId, setEditingSubtaskId] = useState<number | null>(null);
  const [editingSubtaskTitle, setEditingSubtaskTitle] = useState('');
  const [editingSubtaskDescription, setEditingSubtaskDescription] =
    useState('');
  const [editingSubtaskPriority, setEditingSubtaskPriority] = useState<Priority>('medium');
  const [editingSubtaskLabels, setEditingSubtaskLabels] = useState('');
  const [editingSubtaskEstimatedHours, setEditingSubtaskEstimatedHours] = useState('');
  const [isSubtaskSelectionMode, setIsSubtaskSelectionMode] = useState(false);
  const [selectedSubtaskIds, setSelectedSubtaskIds] = useState<Set<number>>(
    new Set(),
  );
  const [showSubtaskDeleteConfirm, setShowSubtaskDeleteConfirm] = useState<
    'all' | 'selected' | null
  >(null);

  // --- Task CRUD ---

  const updateStatus = useCallback(
    async (taskId: number, newStatus: string) => {
      if (newStatus === 'done') {
        setShowCompleteOverlay(true);
      }

      const previousTask = task;
      setTask((prev) => {
        if (!prev) return prev;
        if (prev.id === taskId) {
          return { ...prev, status: newStatus as Task['status'] };
        }
        if (prev.subtasks) {
          const updatedSubtasks = prev.subtasks.map((subtask) =>
            subtask.id === taskId
              ? { ...subtask, status: newStatus as Task['status'] }
              : subtask,
          );
          return { ...prev, subtasks: updatedSubtasks };
        }
        return prev;
      });

      try {
        const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) {
          setTask(previousTask);
          throw new Error('ステータス更新に失敗しました');
        }
        onTaskUpdated?.();
      } catch (err) {
        logger.error(err);
        setTask(previousTask);
      }
    },
    [task, setTask, onTaskUpdated, setShowCompleteOverlay],
  );

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

  const deleteTask = useCallback(async () => {
    if (!confirm('このタスクを削除しますか?')) return;

    try {
      const res = await fetch(`${API_BASE}/tasks/${task?.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('削除に失敗しました');

      if (isThisTaskTimer && pomodoroState.isTimerRunning) {
        stopTimer();
      }
      setShowPomodoroModal(false);
      router.back();
    } catch (err) {
      logger.error(err);
      alert('タスクの削除に失敗しました');
    }
  }, [
    task?.id,
    isThisTaskTimer,
    pomodoroState.isTimerRunning,
    stopTimer,
    setShowPomodoroModal,
    router,
  ]);

  const duplicateTask = useCallback(async () => {
    if (!task) return;

    try {
      const duplicateData = {
        title: `${task.title} (コピー)`,
        description: task.description || undefined,
        status: 'todo',
        labels: task.labels || undefined,
        labelIds: task.taskLabels?.map((tl) => tl.labelId) || [],
        estimatedHours: task.estimatedHours || undefined,
        dueDate: task.dueDate || undefined,
        projectId: task.projectId || undefined,
        milestoneId: task.milestoneId || undefined,
        themeId: task.themeId || undefined,
      };

      const res = await fetch(`${API_BASE}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(duplicateData),
      });

      if (!res.ok) throw new Error('複製に失敗しました');

      const newTask = await res.json();
      router.push(getTaskDetailPath(newTask.id));
    } catch (err) {
      logger.error(err);
      alert('タスクの複製に失敗しました');
    }
  }, [task, router]);

  const refetchTask = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (res.ok) {
        const data = await res.json();
        setTask(data);
      }
    } catch (err) {
      logger.error('Failed to refetch task:', err);
    }
  }, [resolvedTaskId, setTask]);

  // --- Subtask operations ---

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
      data: { title?: string; description?: string; priority?: string; labels?: string[]; estimatedHours?: number | null },
    ) => {
      try {
        const res = await fetch(`${API_BASE}/tasks/${subtaskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('サブタスクの更新に失敗しました');

        const taskRes = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
        if (taskRes.ok) {
          setTask(await taskRes.json());
        }
        setEditingSubtaskId(null);
        setEditingSubtaskTitle('');
        setEditingSubtaskDescription('');
      } catch (err) {
        logger.error(err);
        alert('サブタスクの更新に失敗しました');
      }
    },
    [resolvedTaskId, setTask],
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
  }, [editingSubtaskId, editingSubtaskTitle, editingSubtaskDescription, editingSubtaskPriority, editingSubtaskLabels, editingSubtaskEstimatedHours, updateSubtask]);

  const toggleSubtaskSelectionMode = useCallback(() => {
    if (isSubtaskSelectionMode) {
      setSelectedSubtaskIds(new Set());
    }
    setIsSubtaskSelectionMode(!isSubtaskSelectionMode);
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

      const taskRes = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
      if (taskRes.ok) {
        setTask(await taskRes.json());
      }
      onTaskUpdated?.();
    } catch (err) {
      logger.error(err);
      alert('サブタスクの削除に失敗しました');
    }
  }, [task, resolvedTaskId, setTask, onTaskUpdated]);

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

        const taskRes = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
        if (taskRes.ok) {
          setTask(await taskRes.json());
        }
        onTaskUpdated?.();
      } catch (err) {
        logger.error(err);
        alert('サブタスクの削除に失敗しました');
      }
    },
    [task, resolvedTaskId, setTask, onTaskUpdated],
  );

  const deleteSubtask = useCallback(
    async (subtaskId: number) => {
      try {
        const res = await fetch(`${API_BASE}/tasks/${subtaskId}`, {
          method: 'DELETE',
        });

        if (!res.ok) throw new Error('削除に失敗しました');

        const taskRes = await fetch(`${API_BASE}/tasks/${resolvedTaskId}`);
        if (taskRes.ok) {
          setTask(await taskRes.json());
        }
        onTaskUpdated?.();
      } catch (err) {
        logger.error(err);
        alert('サブタスクの削除に失敗しました');
      }
    },
    [resolvedTaskId, setTask, onTaskUpdated],
  );

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
    // Edit form state
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
    // Subtask editing state
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
    isSubtaskSelectionMode,
    selectedSubtaskIds,
    showSubtaskDeleteConfirm,
    setShowSubtaskDeleteConfirm,
    // Task CRUD actions
    updateStatus,
    startEditing,
    cancelEditing,
    saveTask,
    deleteTask,
    duplicateTask,
    refetchTask,
    // Subtask actions
    startEditingSubtask,
    cancelEditingSubtask,
    saveSubtaskEdit,
    toggleSubtaskSelectionMode,
    toggleSubtaskSelection,
    selectAllSubtasks,
    deselectAllSubtasks,
    handleDeleteSelectedSubtasks,
    handleDeleteAllSubtasks,
    deleteSubtask,
  };
}
