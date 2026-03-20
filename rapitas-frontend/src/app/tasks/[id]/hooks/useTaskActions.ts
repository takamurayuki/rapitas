/**
 * useTaskActions
 *
 * Orchestrates all task-level and subtask-level actions for the task detail page.
 * Delegates task field editing to useTaskEdit and subtask management to
 * useSubtaskManagement. Owns task CRUD (status update, delete, duplicate, refetch).
 */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Task } from '@/types';
import { getTaskDetailPath } from '@/utils/tauri';
import { API_BASE_URL } from '@/utils/api';
import { clearApiCache } from '@/lib/api-client';
import { createLogger } from '@/lib/logger';
import { useTaskEdit } from './useTaskEdit';
import { useSubtaskManagement } from './useSubtaskManagement';

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

/**
 * Combines task editing, subtask management, and task CRUD into a single hook.
 *
 * @param params - task context and UI callbacks / タスクコンテキストとUIコールバック
 * @returns all task and subtask action state and handlers
 */
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

  const taskEdit = useTaskEdit({ task, setTask });
  const subtaskManagement = useSubtaskManagement({
    task,
    resolvedTaskId,
    setTask,
    onTaskUpdated,
  });

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
          return {
            ...prev,
            subtasks: prev.subtasks.map((subtask) =>
              subtask.id === taskId
                ? { ...subtask, status: newStatus as Task['status'] }
                : subtask,
            ),
          };
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
        // NOTE: Invalidate apiFetch cache so subsequent fetches get fresh data
        clearApiCache(`/tasks/${taskId}`);
        onTaskUpdated?.();
      } catch (err) {
        logger.error(err);
        setTask(previousTask);
      }
    },
    [task, setTask, onTaskUpdated, setShowCompleteOverlay],
  );

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
        setTask(await res.json());
      }
    } catch (err) {
      logger.error('Failed to refetch task:', err);
    }
  }, [resolvedTaskId, setTask]);

  return {
    // Task edit state
    ...taskEdit,
    // Subtask management state
    ...subtaskManagement,
    // Task CRUD
    updateStatus,
    deleteTask,
    duplicateTask,
    refetchTask,
  };
}
