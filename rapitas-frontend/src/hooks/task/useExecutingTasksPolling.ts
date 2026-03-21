'use client';

import { useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useExecutingTasksPolling');

/**
 * Hook for detecting executing tasks via polling and reflecting to global store
 * Used in parent components like HomeClient and kanban pages
 */
export function useExecutingTasksPolling(options?: {
  /** Polling interval (ms) Default: 5000ms */
  interval?: number;
  /** Callback when new executing task is found */
  onExecutingTaskFound?: (taskId: number) => void;
}) {
  const { interval = 5000, onExecutingTaskFound } = options || {};
  const { setExecutingTask, removeExecutingTask } = useExecutionStateStore();
  const fetchTaskUpdates = useTaskCacheStore((s) => s.fetchUpdates);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onExecutingTaskFoundRef = useRef(onExecutingTaskFound);

  // Set of previously detected task IDs (for new detection)
  const knownTaskIdsRef = useRef<Set<number>>(new Set());

  // Dynamic polling interval management
  const currentIntervalRef = useRef(interval);
  const errorCountRef = useRef(0);
  const lastSuccessTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    onExecutingTaskFoundRef.current = onExecutingTaskFound;
  }, [onExecutingTaskFound]);

  // Dynamically adjust polling interval
  const adjustPollingInterval = useCallback(
    (hasExecutingTasks: boolean, hadError: boolean) => {
      let newInterval = interval;

      if (hadError) {
        // Double interval on error (max 30s)
        newInterval = Math.min(currentIntervalRef.current * 2, 30000);
        logger.debug(`Error occurred, increasing interval to ${newInterval}ms`);
      } else if (hasExecutingTasks) {
        // Short interval when tasks are running (keep default)
        newInterval = interval;
        if (currentIntervalRef.current !== interval) {
          logger.debug(
            `Tasks executing, resetting interval to ${newInterval}ms`,
          );
        }
      } else {
        // Longer interval when no tasks running (max 15s)
        newInterval = Math.min(interval * 2, 15000);
        if (currentIntervalRef.current !== newInterval) {
          logger.debug(
            `No tasks executing, increasing interval to ${newInterval}ms`,
          );
        }
      }

      // Reset timer when interval changes
      if (currentIntervalRef.current !== newInterval) {
        currentIntervalRef.current = newInterval;

        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = setInterval(checkExecutingTasks, newInterval);
        }
      }
    },
    [interval],
  );

  const checkExecutingTasks = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8 second timeout

      const res = await fetch(`${API_BASE_URL}/tasks/executing`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data: Array<{
        taskId: number;
        sessionId: number;
        executionStatus: string;
      }> = await res.json();

      const currentExecutingIds = new Set<number>();

      for (const item of data) {
        if (
          item.executionStatus === 'running' ||
          item.executionStatus === 'waiting_for_input'
        ) {
          currentExecutingIds.add(item.taskId);
          setExecutingTask({
            taskId: item.taskId,
            sessionId: item.sessionId,
            status: item.executionStatus as 'running' | 'waiting_for_input',
          });

          // Only callback for newly detected tasks
          if (
            !knownTaskIdsRef.current.has(item.taskId) &&
            onExecutingTaskFoundRef.current
          ) {
            onExecutingTaskFoundRef.current(item.taskId);
          }
        }
      }

      // Remove tasks that were running but are no longer present
      let hasRemovedTasks = false;
      for (const prevId of knownTaskIdsRef.current) {
        if (!currentExecutingIds.has(prevId)) {
          removeExecutingTask(prevId);
          hasRemovedTasks = true;
        }
      }

      knownTaskIdsRef.current = currentExecutingIds;

      // Silently update tasks when running or completed
      if (currentExecutingIds.size > 0 || hasRemovedTasks) {
        fetchTaskUpdates(true); // silent mode
      }

      errorCountRef.current = 0;
      lastSuccessTimeRef.current = Date.now();
      adjustPollingInterval(currentExecutingIds.size > 0, false);
    } catch (error) {
      errorCountRef.current++;
      const timeSinceLastSuccess = Date.now() - lastSuccessTimeRef.current;

      logger.warn(
        `Fetch failed (attempt ${errorCountRef.current}, ${Math.round(timeSinceLastSuccess / 1000)}s since last success):`,
        error,
      );

      adjustPollingInterval(knownTaskIdsRef.current.size > 0, true);

      // Reset known task state on prolonged errors
      if (timeSinceLastSuccess > 60000) {
        // 1 minute
        logger.warn('Long-term connectivity issues, clearing known tasks');
        knownTaskIdsRef.current.clear();
      }
    }
  }, [
    setExecutingTask,
    removeExecutingTask,
    fetchTaskUpdates,
    adjustPollingInterval,
  ]);

  useEffect(() => {
    currentIntervalRef.current = interval;
    errorCountRef.current = 0;
    lastSuccessTimeRef.current = Date.now();

    // Immediate initial check
    checkExecutingTasks();

    // Set timer with initial interval
    intervalRef.current = setInterval(checkExecutingTasks, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [interval, checkExecutingTasks]);
}
