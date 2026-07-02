'use client';
// useKanbanBoard

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DropResult } from '@hello-pangea/dnd';
import { useTaskDetailVisibilityStore } from '@/stores/task-detail-visibility-store';
import { API_BASE_URL } from '@/utils/api';
import { useExecutingTasksPolling } from '@/hooks/task/useExecutingTasksPolling';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { useTaskAutoSync } from '@/hooks/task/useTaskAutoSync';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { createLogger } from '@/lib/logger';
import type { Status } from '@/types';

const logger = createLogger('useKanbanBoard');
const API_BASE = API_BASE_URL;

interface ExecutionClasses {
  cardClass: string;
  borderColor: 'blue' | 'amber';
  badgeClass: string;
  dotClass: string;
  label: string;
}

/**
 * Manages task data fetching, status mutations, panel state, and execution
 * badge derivation for the Kanban board page.
 *
 * @param runningLabel - Translated label for "running" execution state
 * @param waitingLabel - Translated label for "waiting for input" execution state
 * @param updateFailedMessage - Translated error message for status update failure
 * @returns Board state and handlers
 */
export function useKanbanBoard(
  runningLabel: string,
  waitingLabel: string,
  updateFailedMessage: string,
) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tasks = useTaskCacheStore((s) => s.tasks);
  const taskCacheInitialized = useTaskCacheStore((s) => s.initialized);
  const taskCacheLoading = useTaskCacheStore((s) => s.loading);
  const fetchAllTasks = useTaskCacheStore((s) => s.fetchAll);
  const fetchTaskUpdates = useTaskCacheStore((s) => s.fetchUpdates);
  const updateTaskLocally = useTaskCacheStore((s) => s.updateTaskLocally);
  const getExecutingTaskStatus = useExecutionStateStore((s) => s.getExecutingTaskStatus);
  const [loading, setLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const { showTaskDetail, hideTaskDetail } = useTaskDetailVisibilityStore();

  // Enable auto-sync
  useTaskAutoSync({ enabled: true, interval: 30000, silent: true });

  const fetchTasks = useCallback(async () => {
    if (taskCacheInitialized) {
      await fetchTaskUpdates();
    } else {
      setLoading(true);
      await fetchAllTasks();
      setLoading(false);
    }
  }, [taskCacheInitialized, fetchTaskUpdates, fetchAllTasks]);

  const updateStatus = async (id: number, status: string) => {
    const oldTask = tasks.find((task) => task.id === id);
    updateTaskLocally(id, { status: status as Status });

    try {
      const res = await fetch(`${API_BASE}/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(updateFailedMessage);
    } catch (e) {
      logger.error(e);
      if (oldTask) {
        updateTaskLocally(id, { status: oldTask.status });
      }
    }
  };

  const onDragEnd = (result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index)
      return;

    updateStatus(parseInt(draggableId), destination.droppableId);
  };

  const openTaskPanel = useCallback(
    (taskId: number) => {
      setSelectedTaskId(taskId);
      setIsPanelOpen(true);
      showTaskDetail();
      // NOTE: Encode the open panel in the URL so router.back() from the note split view
      // returns here with ?panel=taskId, allowing the mount effect below to re-open it.
      router.replace(`/kanban?panel=${taskId}`);
    },
    [router, showTaskDetail],
  );

  const closeTaskPanel = useCallback(() => {
    setIsPanelOpen(false);
    hideTaskDetail();
    setTimeout(() => setSelectedTaskId(null), 300);
    // Remove panel param from URL, preserving other params.
    const params = new URLSearchParams(window.location.search);
    params.delete('panel');
    const qs = params.toString();
    router.replace('/kanban' + (qs ? `?${qs}` : ''));
  }, [router, hideTaskDetail]);

  // NOTE: Poll only to reflect executing state onto cards (spinner). Auto-opening
  // the detail panel on execution covered the board with its backdrop and made it
  // look frozen; the user opens a task manually when they want to watch progress.
  useExecutingTasksPolling({ interval: 5000 });

  const openTaskInPage = (taskId: number) => {
    router.push(`/tasks/${taskId}?showHeader=true`);
  };

  useEffect(() => {
    fetchTasks();

    // Restore slide panel after returning from the note split view via router.back().
    // NOTE: [] is intentional — runs once on mount only to restore URL-encoded panel state.
    const panelTaskId = searchParams.get('panel');
    if (panelTaskId) {
      openTaskPanel(Number(panelTaskId));
    }

    const handleFocus = () => fetchTaskUpdates();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Returns execution-state CSS classes and label for a task card.
   *
   * @param taskId - Task to query execution state for
   * @returns Styling object or null if task is not executing
   */
  const getKanbanExecutionClasses = (taskId: number): ExecutionClasses | null => {
    const executionStatus = getExecutingTaskStatus(taskId);
    switch (executionStatus) {
      case 'running':
        return {
          cardClass: 'execution-pulse-blue',
          borderColor: 'blue',
          badgeClass: 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300',
          dotClass: 'bg-indigo-500',
          label: runningLabel,
        };
      case 'waiting_for_input':
        return {
          cardClass: 'execution-pulse-amber',
          borderColor: 'amber',
          badgeClass: 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300',
          dotClass: 'bg-amber-500',
          label: waitingLabel,
        };
      default:
        return null;
    }
  };

  return {
    tasks,
    taskCacheInitialized,
    taskCacheLoading,
    loading,
    selectedTaskId,
    isPanelOpen,
    fetchTasks,
    onDragEnd,
    openTaskPanel,
    closeTaskPanel,
    openTaskInPage,
    getKanbanExecutionClasses,
  };
}
