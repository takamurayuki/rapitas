'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { ParallelExecutionStatus } from '../components/SubtaskExecutionStatus';
import { useExecutionStateStore } from '@/stores/executionStateStore';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useParallelExecutionStatus');

/**
 * Subtask execution status
 */
export interface SubtaskExecutionState {
  taskId: number;
  status: ParallelExecutionStatus;
  startedAt?: Date;
  completedAt?: Date;
  executionTimeMs?: number;
  tokensUsed?: number;
  error?: string;
}

/**
 * Parallel execution session state
 */
export interface ParallelSessionState {
  sessionId: string;
  status: ParallelExecutionStatus;
  progress: number;
  currentLevel: number;
  completedTasks: number[];
  runningTasks: number[];
  pendingTasks: number[];
  failedTasks: number[];
  blockedTasks: number[];
  subtaskStates: Map<number, SubtaskExecutionState>;
  totalTokensUsed: number;
  totalExecutionTimeMs: number;
}

/**
 * SSE event type
 */
interface ParallelExecutionEvent {
  type:
    | 'session_started'
    | 'session_completed'
    | 'session_failed'
    | 'task_started'
    | 'task_completed'
    | 'task_failed'
    | 'level_started'
    | 'level_completed'
    | 'progress_updated';
  sessionId: string;
  taskId?: number;
  level?: number;
  data?: {
    executionTimeMs?: number;
    tokensUsed?: number;
    errorMessage?: string;
    progress?: number;
    completed?: number[];
    running?: number[];
    pending?: number[];
    failed?: number[];
    blocked?: number[];
  };
  timestamp: string;
}

interface UseParallelExecutionStatusOptions {
  /** Task ID */
  taskId: number;
  /** Whether to enable SSE connection */
  enableSSE?: boolean;
  /** Polling interval in milliseconds */
  pollingInterval?: number;
}

interface UseParallelExecutionStatusReturn {
  /** Session ID */
  sessionId: string | null;
  /** Session state */
  sessionState: ParallelSessionState | null;
  /** Whether connected */
  isConnected: boolean;
  /** Whether running */
  isRunning: boolean;
  /** Error */
  error: string | null;
  /** Get subtask execution status */
  getSubtaskStatus: (subtaskId: number) => ParallelExecutionStatus | undefined;
  /** Start session */
  startSession: (config?: {
    maxConcurrentAgents?: number;
  }) => Promise<string | null>;
  /** Stop session */
  stopSession: () => Promise<void>;
  /** Update status (manual) */
  refreshStatus: () => Promise<void>;
}

/**
 * Hook to monitor parallel execution session status
 *
 * Retrieves subtask execution status in real-time via SSE or polling.
 */
export function useParallelExecutionStatus({
  taskId,
  enableSSE = true,
  pollingInterval = 3000,
}: UseParallelExecutionStatusOptions): UseParallelExecutionStatusReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<ParallelSessionState | null>(
    null,
  );
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  // NOTE: Also hold sessionId in ref to prevent stale closure references
  const sessionIdRef = useRef<string | null>(null);

  // Access global execution state store
  const { setExecutingTask, removeExecutingTask } = useExecutionStateStore();

  const getSubtaskStatus = useCallback(
    (subtaskId: number): ParallelExecutionStatus | undefined => {
      return sessionState?.subtaskStates.get(subtaskId)?.status;
    },
    [sessionState],
  );

  // Check if execution is currently running
  const isRunning =
    sessionState?.status === 'running' || sessionState?.status === 'scheduled';

  // Process SSE events
  const handleSSEEvent = useCallback((event: ParallelExecutionEvent) => {
    setSessionState((prev) => {
      if (!prev) {
        // Create initial state
        prev = {
          sessionId: event.sessionId,
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
        };
      }

      const newState = { ...prev, subtaskStates: new Map(prev.subtaskStates) };

      switch (event.type) {
        case 'session_started':
          newState.status = 'running';
          break;

        case 'session_completed':
          newState.status = 'completed';
          if (event.data?.tokensUsed) {
            newState.totalTokensUsed = event.data.tokensUsed;
          }
          if (event.data?.executionTimeMs) {
            newState.totalExecutionTimeMs = event.data.executionTimeMs;
          }
          break;

        case 'session_failed':
          newState.status = 'failed';
          break;

        case 'task_started':
          if (event.taskId) {
            newState.subtaskStates.set(event.taskId, {
              taskId: event.taskId,
              status: 'running',
              startedAt: new Date(event.timestamp),
            });
            if (!newState.runningTasks.includes(event.taskId)) {
              newState.runningTasks = [...newState.runningTasks, event.taskId];
            }
            newState.pendingTasks = newState.pendingTasks.filter(
              (id) => id !== event.taskId,
            );
          }
          break;

        case 'task_completed':
          if (event.taskId) {
            const existingState = newState.subtaskStates.get(event.taskId);
            newState.subtaskStates.set(event.taskId, {
              ...existingState,
              taskId: event.taskId,
              status: 'completed',
              completedAt: new Date(event.timestamp),
              executionTimeMs: event.data?.executionTimeMs,
              tokensUsed: event.data?.tokensUsed,
            });
            if (!newState.completedTasks.includes(event.taskId)) {
              newState.completedTasks = [
                ...newState.completedTasks,
                event.taskId,
              ];
            }
            newState.runningTasks = newState.runningTasks.filter(
              (id) => id !== event.taskId,
            );
          }
          break;

        case 'task_failed':
          if (event.taskId) {
            const existingState = newState.subtaskStates.get(event.taskId);
            newState.subtaskStates.set(event.taskId, {
              ...existingState,
              taskId: event.taskId,
              status: 'failed',
              completedAt: new Date(event.timestamp),
              error: event.data?.errorMessage,
            });
            if (!newState.failedTasks.includes(event.taskId)) {
              newState.failedTasks = [...newState.failedTasks, event.taskId];
            }
            newState.runningTasks = newState.runningTasks.filter(
              (id) => id !== event.taskId,
            );
          }
          break;

        case 'level_started':
          if (event.level !== undefined) {
            newState.currentLevel = event.level;
          }
          break;

        case 'level_completed':
          break;

        case 'progress_updated':
          if (event.data) {
            if (event.data.progress !== undefined) {
              newState.progress = event.data.progress;
            }
            if (event.data.completed) {
              newState.completedTasks = event.data.completed;
            }
            if (event.data.running) {
              newState.runningTasks = event.data.running;
            }
            if (event.data.pending) {
              newState.pendingTasks = event.data.pending;
            }
            if (event.data.failed) {
              newState.failedTasks = event.data.failed;
            }
            if (event.data.blocked) {
              newState.blockedTasks = event.data.blocked;
            }

            event.data.completed?.forEach((id) => {
              if (!newState.subtaskStates.has(id)) {
                newState.subtaskStates.set(id, {
                  taskId: id,
                  status: 'completed',
                });
              } else {
                const existing = newState.subtaskStates.get(id)!;
                newState.subtaskStates.set(id, {
                  ...existing,
                  status: 'completed',
                });
              }
            });
            event.data.running?.forEach((id) => {
              if (!newState.subtaskStates.has(id)) {
                newState.subtaskStates.set(id, {
                  taskId: id,
                  status: 'running',
                });
              } else {
                const existing = newState.subtaskStates.get(id)!;
                if (existing.status !== 'completed') {
                  newState.subtaskStates.set(id, {
                    ...existing,
                    status: 'running',
                  });
                }
              }
            });
            event.data.failed?.forEach((id) => {
              if (!newState.subtaskStates.has(id)) {
                newState.subtaskStates.set(id, {
                  taskId: id,
                  status: 'failed',
                });
              } else {
                const existing = newState.subtaskStates.get(id)!;
                newState.subtaskStates.set(id, {
                  ...existing,
                  status: 'failed',
                });
              }
            });
            event.data.blocked?.forEach((id) => {
              if (!newState.subtaskStates.has(id)) {
                newState.subtaskStates.set(id, {
                  taskId: id,
                  status: 'blocked',
                });
              } else {
                const existing = newState.subtaskStates.get(id)!;
                if (
                  existing.status !== 'completed' &&
                  existing.status !== 'running'
                ) {
                  newState.subtaskStates.set(id, {
                    ...existing,
                    status: 'blocked',
                  });
                }
              }
            });
          }
          break;
      }

      return newState;
    });
  }, []);

  // NOTE: Fetch status via polling (uses ref to prevent stale closure references)
  const fetchStatus = useCallback(async () => {
    const currentSessionId = sessionIdRef.current;
    if (!currentSessionId) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/parallel/sessions/${currentSessionId}/status`,
      );
      if (!res.ok) {
        throw new Error('ステータスの取得に失敗しました');
      }
      const result = await res.json();
      if (result.success && result.data) {
        const data = result.data;
        setSessionState((prev) => {
          const newSubtaskStates = new Map(prev?.subtaskStates || new Map());

          // completedTasks
          data.completed?.forEach((id: number) => {
            newSubtaskStates.set(id, {
              ...newSubtaskStates.get(id),
              taskId: id,
              status: 'completed',
            });
          });

          // runningTasks
          data.running?.forEach((id: number) => {
            if (newSubtaskStates.get(id)?.status !== 'completed') {
              newSubtaskStates.set(id, {
                ...newSubtaskStates.get(id),
                taskId: id,
                status: 'running',
              });
            }
          });

          // failedTasks
          data.failed?.forEach((id: number) => {
            newSubtaskStates.set(id, {
              ...newSubtaskStates.get(id),
              taskId: id,
              status: 'failed',
            });
          });

          // blockedTasks
          data.blocked?.forEach((id: number) => {
            const existing = newSubtaskStates.get(id);
            if (
              !existing ||
              (existing.status !== 'completed' &&
                existing.status !== 'running' &&
                existing.status !== 'failed')
            ) {
              newSubtaskStates.set(id, {
                ...newSubtaskStates.get(id),
                taskId: id,
                status: 'blocked',
              });
            }
          });

          return {
            sessionId: currentSessionId,
            status: data.status as ParallelExecutionStatus,
            progress: data.progress || 0,
            currentLevel: prev?.currentLevel || 0,
            completedTasks: data.completed || [],
            runningTasks: data.running || [],
            pendingTasks: data.pending || [],
            failedTasks: data.failed || [],
            blockedTasks: data.blocked || [],
            subtaskStates: newSubtaskStates,
            totalTokensUsed: prev?.totalTokensUsed || 0,
            totalExecutionTimeMs: prev?.totalExecutionTimeMs || 0,
          };
        });
      }
    } catch (err) {
      logger.error('[Polling] Failed to fetch status:', err);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  // Start SSE connection
  const connectSSE = useCallback(
    (sId: string) => {
      if (!enableSSE) return;

      // Close existing connection
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
            handleSSEEvent(data as ParallelExecutionEvent);
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
          pollingIntervalRef.current = setInterval(
            fetchStatus,
            pollingInterval,
          );
        }
      };

      eventSourceRef.current = eventSource;
    },
    [enableSSE, handleSSEEvent, fetchStatus, pollingInterval],
  );

  // Start session
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
          throw new Error(errorData.error || 'セッションの開始に失敗しました');
        }

        const result = await res.json();
        if (result.success && result.data?.sessionId) {
          const newSessionId = result.data.sessionId;
          // NOTE: Update ref synchronously first so fetchStatus can use it immediately
          sessionIdRef.current = newSessionId;
          setSessionId(newSessionId);

          // Set initial state
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

          // Start SSE connection
          connectSSE(newSessionId);

          // Record running tasks in global store
          setExecutingTask({
            taskId,
            status: 'running',
          });

          return newSessionId;
        }
        return null;
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'セッションの開始に失敗しました';
        setError(errorMessage);
        return null;
      }
    },
    [taskId, connectSSE, setExecutingTask],
  );

  // Stop session
  const stopSession = useCallback(async () => {
    if (!sessionId) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/parallel/sessions/${sessionId}/stop`,
        {
          method: 'POST',
        },
      );

      if (!res.ok) {
        throw new Error('セッションの停止に失敗しました');
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }

      setSessionState((prev) =>
        prev
          ? {
              ...prev,
              status: 'cancelled',
            }
          : null,
      );

      sessionIdRef.current = null;

      removeExecutingTask(taskId);
    } catch (err) {
      logger.error('[StopSession] Error:', err);
    }
  }, [sessionId, removeExecutingTask, taskId]);

  // Watch session state changes and update store
  useEffect(() => {
    if (
      sessionState?.status === 'completed' ||
      sessionState?.status === 'failed' ||
      sessionState?.status === 'cancelled'
    ) {
      // Remove from store when execution completes
      removeExecutingTask(taskId);

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }

      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  }, [sessionState?.status, removeExecutingTask, taskId]);

  // Start/stop polling
  useEffect(() => {
    if (sessionId && isRunning && !isConnected) {
      // NOTE: Poll only when SSE is not connected (and not already started by onerror)
      if (!pollingIntervalRef.current) {
        pollingIntervalRef.current = setInterval(fetchStatus, pollingInterval);
      }
    } else if (!isRunning || isConnected) {
      // Stop polling when execution completes or SSE connection is restored
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [sessionId, isRunning, isConnected, pollingInterval, fetchStatus]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      sessionIdRef.current = null;
    };
  }, []);

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
