'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import type { ParallelExecutionStatus } from '../components/SubtaskExecutionStatus';
import { useExecutionStateStore } from '@/stores/executionStateStore';

/**
 * サブタスクの実行ステータス
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
 * 並列実行セッションの状態
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
 * SSEイベントの型
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
  /** タスクID */
  taskId: number;
  /** SSE接続を有効にするか */
  enableSSE?: boolean;
  /** ポーリング間隔（ミリ秒） */
  pollingInterval?: number;
}

interface UseParallelExecutionStatusReturn {
  /** セッションID */
  sessionId: string | null;
  /** セッション状態 */
  sessionState: ParallelSessionState | null;
  /** 接続中かどうか */
  isConnected: boolean;
  /** 実行中かどうか */
  isRunning: boolean;
  /** エラー */
  error: string | null;
  /** サブタスクの実行ステータスを取得 */
  getSubtaskStatus: (subtaskId: number) => ParallelExecutionStatus | undefined;
  /** セッションを開始 */
  startSession: (config?: {
    maxConcurrentAgents?: number;
  }) => Promise<string | null>;
  /** セッションを停止 */
  stopSession: () => Promise<void>;
  /** ステータスを更新（手動） */
  refreshStatus: () => Promise<void>;
}

/**
 * 並列実行セッションのステータスを監視するフック
 *
 * SSEまたはポーリングを使用して、リアルタイムでサブタスクの実行状況を取得します。
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

  // グローバル実行状態ストアへのアクセス
  const { setExecutingTask, removeExecutingTask } = useExecutionStateStore();

  // サブタスクのステータスを取得
  const getSubtaskStatus = useCallback(
    (subtaskId: number): ParallelExecutionStatus | undefined => {
      return sessionState?.subtaskStates.get(subtaskId)?.status;
    },
    [sessionState],
  );

  // 実行中かどうか
  const isRunning =
    sessionState?.status === 'running' || sessionState?.status === 'scheduled';

  // SSEイベントを処理
  const handleSSEEvent = useCallback((event: ParallelExecutionEvent) => {
    setSessionState((prev) => {
      if (!prev) {
        // 初期状態を作成
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
            // runningTasksに追加
            if (!newState.runningTasks.includes(event.taskId)) {
              newState.runningTasks = [...newState.runningTasks, event.taskId];
            }
            // pendingTasksから削除
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
            // completedTasksに追加
            if (!newState.completedTasks.includes(event.taskId)) {
              newState.completedTasks = [
                ...newState.completedTasks,
                event.taskId,
              ];
            }
            // runningTasksから削除
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
            // failedTasksに追加
            if (!newState.failedTasks.includes(event.taskId)) {
              newState.failedTasks = [...newState.failedTasks, event.taskId];
            }
            // runningTasksから削除
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
          // レベル完了時の処理（必要に応じて）
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

            // subtaskStatesも更新
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

  // SSE接続を開始
  const connectSSE = useCallback(
    (sId: string) => {
      if (!enableSSE) return;

      // 既存の接続をクローズ
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
          console.error('[SSE] Failed to parse event:', err);
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
        // エラー時は自動的にポーリングにフォールバック
      };

      eventSourceRef.current = eventSource;
    },
    [enableSSE, handleSSEEvent],
  );

  // ステータスをポーリングで取得
  const fetchStatus = useCallback(async () => {
    if (!sessionId) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/parallel/sessions/${sessionId}/status`,
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
            sessionId: sessionId,
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
      console.error('[Polling] Failed to fetch status:', err);
    }
  }, [sessionId]);

  // ステータスを手動で更新
  const refreshStatus = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  // セッションを開始
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
          setSessionId(newSessionId);

          // 初期状態を設定
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

          // SSE接続を開始
          connectSSE(newSessionId);

          // グローバルストアに実行中タスクを記録
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

  // セッションを停止
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

      // SSE接続をクローズ
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      setSessionState((prev) =>
        prev
          ? {
              ...prev,
              status: 'cancelled',
            }
          : null,
      );

      // グローバルストアから削除
      removeExecutingTask(taskId);
    } catch (err) {
      console.error('[StopSession] Error:', err);
    }
  }, [sessionId, removeExecutingTask, taskId]);

  // セッション状態の変化を監視してストアを更新
  useEffect(() => {
    if (sessionState?.status === 'completed' || sessionState?.status === 'failed' || sessionState?.status === 'cancelled') {
      // 終了状態になったらストアから削除
      removeExecutingTask(taskId);

      // SSE接続も確実に切断
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setIsConnected(false);
      }

      // ポーリングも停止
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }
  }, [sessionState?.status, removeExecutingTask, taskId]);

  // ポーリングを開始/停止
  useEffect(() => {
    if (sessionId && isRunning && !isConnected) {
      // SSEが接続されていない場合はポーリング
      pollingIntervalRef.current = setInterval(fetchStatus, pollingInterval);
    } else {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [sessionId, isRunning, isConnected, pollingInterval, fetchStatus]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
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
