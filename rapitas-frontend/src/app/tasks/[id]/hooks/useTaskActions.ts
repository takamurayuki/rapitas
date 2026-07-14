/**
 * useTaskActions
 *
 * Orchestrates all task-level and subtask-level actions for the task detail page.
 * Delegates task field editing to useTaskEdit and subtask management to
 * useSubtaskManagement. Owns task CRUD (status update, delete, refetch).
 */

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Task } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { clearApiCache } from '@/lib/api-client';
import { createLogger } from '@/lib/logger';
import { useTaskEdit } from './useTaskEdit';
import { useSubtaskManagement } from './useSubtaskManagement';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';

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
  const t = useTranslations('task');
  const { showToast } = useToast();
  const confirm = useConfirmDialog();

  const taskEdit = useTaskEdit({ task, setTask });
  const subtaskManagement = useSubtaskManagement({
    task,
    resolvedTaskId,
    setTask,
    onTaskUpdated,
  });

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

  const updateStatus = useCallback(
    async (taskId: number, newStatus: string) => {
      if (newStatus === 'done') {
        setShowCompleteOverlay(true);
      }

      const previousTask = task;
      const isSubtaskUpdate = task ? taskId !== task.id : false;
      setTask((prev) => {
        if (!prev) return prev;
        if (prev.id === taskId) {
          return { ...prev, status: newStatus as Task['status'] };
        }
        if (prev.subtasks) {
          return {
            ...prev,
            subtasks: prev.subtasks.map((subtask) =>
              subtask.id === taskId ? { ...subtask, status: newStatus as Task['status'] } : subtask,
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
          throw new Error(t('statusUpdateFailed'));
        }
        // NOTE: Invalidate apiFetch cache so subsequent fetches get fresh data
        clearApiCache(`/tasks/${taskId}`);
        // NOTE: A subtask's status change can trigger backend-side recomputation
        // of the PARENT task's own status (and actualHours) — the optimistic
        // patch above only touches the subtask entry in local state, so without
        // this the page keeps showing the parent's stale status until a manual
        // reload. Refetch the whole (parent) task to pick up that side effect.
        if (isSubtaskUpdate) {
          await refetchTask();
        }
        onTaskUpdated?.();
      } catch (err) {
        logger.error(err);
        setTask(previousTask);
      }
    },
    [task, setTask, onTaskUpdated, setShowCompleteOverlay, t, refetchTask],
  );

  const deleteTask = useCallback(async () => {
    // Protected tasks can't be deleted; tell the user how to unprotect first
    // (backend also enforces this with a 409).
    if (task?.isProtected) {
      showToast(t('protectedDeleteWarning'), 'warning');
      return;
    }
    if (!(await confirm({ message: t('deleteTaskConfirm'), variant: 'destructive' }))) return;

    try {
      const res = await fetch(`${API_BASE}/tasks/${task?.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(t('deleteTaskFailed'));

      if (isThisTaskTimer && pomodoroState.isTimerRunning) {
        stopTimer();
      }
      setShowPomodoroModal(false);
      router.back();
    } catch (err) {
      logger.error(err);
      showToast(t('deleteTaskFailed'), 'error');
    }
  }, [
    task?.id,
    task?.isProtected,
    isThisTaskTimer,
    pomodoroState.isTimerRunning,
    stopTimer,
    setShowPomodoroModal,
    router,
    showToast,
    confirm,
    t,
  ]);

  // NOTE: duplicateTask was removed 2026-07-14 — the detail-menu 複製 action
  // was dropped in favor of the template flow (テンプレート設定 → 適用).

  return {
    // Task edit state
    ...taskEdit,
    // Subtask management state
    ...subtaskManagement,
    // Task CRUD
    updateStatus,
    deleteTask,
    refetchTask,
  };
}
