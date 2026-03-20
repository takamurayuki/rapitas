/**
 * useParallelExecutionSetup
 *
 * Composes useParallelExecutionStatus and useSubtaskLogs into a single hook
 * for the task detail page. Extracts parallel execution wiring from the
 * orchestrator to keep TaskDetailClient under 300 lines.
 */

import { useMemo } from 'react';
import { useParallelExecutionStatus } from '@/feature/tasks/hooks/useParallelExecutionStatus';
import { useSubtaskLogs } from '@/feature/tasks/hooks/useSubtaskLogs';
import type { ParallelExecutionStatus } from '@/feature/tasks/components/SubtaskExecutionStatus';
import type { SubtaskLogState } from '@/feature/tasks/hooks/useSubtaskLogs';
import type { Task } from '@/types';

export interface UseParallelExecutionSetupParams {
  taskId: number;
  taskSubtasks: Task['subtasks'];
}

export interface UseParallelExecutionSetupResult {
  parallelSessionId: string | null;
  parallelSessionState: { status?: string } | null;
  isParallelExecutionRunning: boolean;
  getSubtaskStatus: (subtaskId: number) => ParallelExecutionStatus | undefined;
  startSession: () => void;
  subtaskLogs: Map<number, SubtaskLogState>;
  refreshSubtaskLogs: () => void;
}

/**
 * Wires up parallel execution status and subtask log polling.
 *
 * @param params - taskId and subtask list for log subscriptions.
 * @returns Parallel session state and subtask log data.
 */
export function useParallelExecutionSetup({
  taskId,
  taskSubtasks,
}: UseParallelExecutionSetupParams): UseParallelExecutionSetupResult {
  const {
    sessionId: parallelSessionId,
    sessionState: parallelSessionState,
    isRunning: isParallelExecutionRunning,
    getSubtaskStatus,
    startSession,
  } = useParallelExecutionStatus({ taskId, enableSSE: true });

  const subtasksForLogs = useMemo(
    () => (taskSubtasks || []).map((s) => ({ id: s.id, title: s.title })),
    [taskSubtasks],
  );

  const { subtaskLogs, refreshLogs: refreshSubtaskLogs } = useSubtaskLogs({
    sessionId: parallelSessionId,
    subtasks: subtasksForLogs,
    autoRefresh: true,
    pollingInterval: 2000,
    sessionStatus: parallelSessionState?.status,
  });

  return {
    parallelSessionId,
    parallelSessionState,
    isParallelExecutionRunning,
    getSubtaskStatus,
    startSession,
    subtaskLogs,
    refreshSubtaskLogs,
  };
}
