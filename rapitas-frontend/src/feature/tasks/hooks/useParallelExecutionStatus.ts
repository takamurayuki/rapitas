'use client';

/**
 * useParallelExecutionStatus
 *
 * Orchestrates a parallel execution session: starts/stops sessions,
 * subscribes to SSE events, and falls back to polling when SSE drops.
 * Delegates SSE event processing to useParallelSSEHandler and polling
 * to useParallelPolling.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { ParallelExecutionStatus } from '../components/SubtaskExecutionStatus';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import { createLogger } from '@/lib/logger';
import type {
  ParallelSessionState,
  UseParallelExecutionStatusOptions,
  UseParallelExecutionStatusReturn,
  ParallelExecutionEvent,
} from './parallel-execution-types';
import { useParallelSSEHandler } from './useParallelSSEHandler';
import { useParallelPolling } from './useParallelPolling';

// Re-export types so existing imports from this module continue to work
export type {
  SubtaskExecutionState,
  ParallelSessionState,
  UseParallelExecutionStatusOptions,
  UseParallelExecutionStatusReturn,
} from './parallel-execution-types';

const logger = createLogger('useParallelExecutionStatus');

/**
 * Hook to monitor parallel execution session status.
 *
 * Retrieves subtask execution status in real-time via SSE or polling.
 *
 * @param options - taskId, enableSSE, pollingInterval / タスクIDとSSE/ポーリング設定
 * @returns session state and control functions
 */
export function useParallelExecutionStatus({
  taskId,
  enableSSE = true,
  pollingInterval = 3000,
}: UseParallelExecutionStatusOptions): UseParallelExecutionStatusReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] =
    useState<ParallelSessionState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  // NOTE: Also hold sessionId in ref to prevent stale closure references in onerror/fetchStatus
  const sessionIdRef = useRef<string | null>(null);

  const { setExecutingTask, removeExecutingTask } = useExecutionStateStore();
  const { handleSSEEvent } = useParallelSSEHandler();
  const { fetchStatus, startPolling, stopPolling, pollingIntervalRef } =
    useParallelPolling({ sessionIdRef, setSessionState });

  const getSubtaskStatus = useCallback(
    (subtaskId: number): ParallelExecutionStatus | undefined =>
      sessionState?.subtaskStates.get(subtaskId)?.status,
    [sessionState],
  );

  const isRunning =
    sessionState?.status === 'running' || sessionState?.status === 'scheduled';

  const refreshStatus = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  const connectSSE = useCallback(
    (sId: string) => {
      if (!enableSSE) return;

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource(
        `${API_BASE_URL}/parallel/sessions/${sId}/logs/stream`,
      );

      eventSource.onopen = () => {
        setIsConnected(true);
        setError(null);
      };

      eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type) {
            handleSSEEvent(data as ParallelExecutionEvent, setSessionState);
          }
        } catch (err) {
          logger.error('[SSE] Failed to parse event:', err);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        // NOTE: Start polling immediately on SSE disconnect (don't wait for useEffect)
        if (sessionIdRef.current && !pollingIntervalRef.current) {
          logger.info('[SSE] Connection lost, starting polling fallback');
          fetchStatus();
          startPolling(pollingInterval);
        }
      };

      eventSourceRef.current = eventSource;
    },
    [
      enableSSE,
      handleSSEEvent,
      fetchStatus,
      startPolling,
      pollingInterval,
      pollingIntervalRef,
    ],
  );

  const startSession = useCallback(
    async (config?: {
      maxConcurrentAgents?: number;
    }): Promise<string | null> => {
      try {
        setError(null);
        const res = await fetch(
          `${API_BASE_URL}/parallel/tasks/${taskId}/execute`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config }),
          },
        );

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(
            errorData.error || 'セッションの開始に失敗しました',
          );
        }

        const result = await res.json();
        if (result.success && result.data?.sessionId) {
          const newSessionId = result.data.sessionId;
          // NOTE: Update ref synchronously first so fetchStatus can use it immediately
          sessionIdRef.current = newSessionId;
          setSessionId(newSessionId);

          setSessionState({
            sessionId: newSessionId,
            status: 'running',
            progress: 0,
            currentLevel: 0,
            completedTasks: [],
            runningTasks: [],
            pendingTasks: [],
            failedTasks: [],
            blockedTasks: [],
            subtaskStates: new Map(),
            totalTokensUsed: 0,
            totalExecutionTimeMs: 0,
          });

          connectSSE(newSessionId);
          setExecutingTask({ taskId, status: 'running' });
          return newSessionId;
        }
        return null;
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : 'セッションの開始に失敗しました';
        setError(errorMessage);
        return null;
      }
    },
    [taskId, connectSSE, setExecutingTask],
  );

  const stopSession = useCallback(async () => {
    if (!sessionId) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/parallel/sessions/${sessionId}/stop`,
        { method: 'POST' },
      );

      if (!res.ok) {
        throw new Error('セッションの停止に失敗しました');
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      stopPolling();
      setSessionState((prev) =>
        prev ? { ...prev, status: 'cancelled' } : null,
      );
      sessionIdRef.current = null;
      removeExecutingTask(taskId);
    } catch (err) {
      logger.error('[StopSession] Error:', err);
    }
  }, [sessionId, stopPolling, removeExecutingTask, taskId]);

  // Watch session state and clean up when execution ends
  useEffect(() => {
    if (
      sessionState?.status === 'completed' ||
      sessionState?.status === 'failed' ||
      sessionState?.status === 'cancelled'
    ) {
      removeExecutingTask(taskId);

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }
      stopPolling();
    }
  }, [sessionState?.status, removeExecutingTask, taskId, stopPolling]);

  // Start/stop polling based on connection and running state
  useEffect(() => {
    if (sessionId && isRunning && !isConnected) {
      // NOTE: Poll only when SSE is not connected (and not already started by onerror)
      startPolling(pollingInterval);
    } else if (!isRunning || isConnected) {
      stopPolling();
    }

    return () => stopPolling();
  }, [sessionId, isRunning, isConnected, pollingInterval, startPolling, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      stopPolling();
      sessionIdRef.current = null;
    };
  }, [stopPolling]);

  return {
    sessionId,
    sessionState,
    isConnected,
    isRunning,
    error,
    getSubtaskStatus,
    startSession,
    stopSession,
    refreshStatus,
  };
}

export default useParallelExecutionStatus;
