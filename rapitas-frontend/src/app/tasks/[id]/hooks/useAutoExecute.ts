/**
 * useAutoExecute
 *
 * Handles the `autoExecute=true` query parameter. When present on initial
 * mount and the task has loaded, it triggers agent execution automatically
 * and removes the query param from the URL so refreshes do not re-trigger.
 * Not responsible for executing the agent itself — caller provides executeAgent.
 */

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { ReadonlyURLSearchParams } from 'next/navigation';
import type { Task } from '@/types';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useAutoExecute');

export interface UseAutoExecuteParams {
  task: Task | null;
  loading: boolean;
  isExecuting: boolean;
  taskId: number;
  searchParams: ReadonlyURLSearchParams;
  executeAgent: () => void;
  setShowAIAssistant: (show: boolean) => void;
  setTask: React.Dispatch<React.SetStateAction<Task | null>>;
}

/**
 * Triggers agent auto-execution when the `autoExecute=true` query param is set.
 *
 * @param params - Task state, router, and execution callbacks.
 */
export function useAutoExecute({
  task,
  loading,
  isExecuting,
  taskId,
  searchParams,
  executeAgent,
  setShowAIAssistant,
  setTask,
}: UseAutoExecuteParams): void {
  const router = useRouter();
  const autoExecuteTriggered = useRef(false);

  useEffect(() => {
    const shouldAutoExecute = searchParams.get('autoExecute') === 'true';
    if (
      shouldAutoExecute &&
      !autoExecuteTriggered.current &&
      task &&
      !loading &&
      !isExecuting &&
      taskId
    ) {
      autoExecuteTriggered.current = true;

      if (!task.theme?.isDevelopment) {
        logger.warn(
          `Skipping auto-execute for task ${taskId}: theme is not a development project`,
        );
      } else if (!isExecuting) {
        setShowAIAssistant(true);
        if (task.status !== 'in-progress') {
          setTask((prev) => {
            if (!prev) return prev;
            return { ...prev, status: 'in-progress' };
          });
        }
        executeAgent();
      } else {
        logger.warn(
          `Skipping auto-execute for task ${taskId}: already executing`,
        );
      }

      // NOTE: Remove autoExecute param immediately so page refresh won't re-trigger.
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete('autoExecute');
      const newQuery = newParams.toString();
      const basePath = window.location.pathname;
      router.replace(newQuery ? `${basePath}?${newQuery}` : basePath);
    }
  }, [task, loading, isExecuting, taskId, searchParams, executeAgent, router]);
}
