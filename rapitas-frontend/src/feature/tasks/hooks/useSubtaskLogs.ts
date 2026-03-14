'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';

/**
 * サブタスクのログエントリ
 */
export interface SubtaskLogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  taskId?: number;
}

/**
 * データオブジェクトを人間が読みやすい形式にフォーマットする
 */
export function formatLogData(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return String(data);

  const obj = data as Record<string, unknown>;

  // Extract and format commonly used fields first
  const parts: string[] = [];

  // メッセージ系フィールド
  const msgField = obj.message || obj.msg || obj.description || obj.text;
  if (msgField && typeof msgField === 'string') {
    parts.push(msgField);
  }

  // ステータス系フィールド
  if (obj.status && typeof obj.status === 'string') {
    parts.push(`ステータス: ${obj.status}`);
  }

  // タイプ系フィールド
  if (obj.type && typeof obj.type === 'string') {
    parts.push(`タイプ: ${obj.type}`);
  }

  // エラー系フィールド
  if (obj.error && typeof obj.error === 'string') {
    parts.push(`エラー: ${obj.error}`);
  }

  // Add other fields in key: value format
  const skipKeys = new Set([
    'message',
    'msg',
    'description',
    'text',
    'status',
    'type',
    'error',
    'timestamp',
    'level',
  ]);
  for (const [key, value] of Object.entries(obj)) {
    if (skipKeys.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}: ${value}`);
    }
  }

  return parts.length > 0 ? parts.join(' | ') : JSON.stringify(data);
}

/**
 * サブタスクのログ状態
 */
export interface SubtaskLogState {
  taskId: number;
  taskTitle: string;
  logs: SubtaskLogEntry[];
  isLoading: boolean;
  error: string | null;
}

interface UseSubtaskLogsOptions {
  /** 並列実行セッションID */
  sessionId: string | null;
  /** サブタスクのリスト（IDとタイトル） */
  subtasks: Array<{ id: number; title: string }>;
  /** ポーリング間隔（ミリ秒） */
  pollingInterval?: number;
  /** 自動更新を有効にするか */
  autoRefresh?: boolean;
  /** 並列実行セッションの状態 */
  sessionStatus?:
    | 'pending'
    | 'scheduled'
    | 'running'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'blocked';
}

interface UseSubtaskLogsReturn {
  /** Log state for each subtask */
  subtaskLogs: Map<number, SubtaskLogState>;
  /** Get logs for a specific subtask */
  getSubtaskLogs: (taskId: number) => SubtaskLogState | undefined;
  /** Manually refresh logs */
  refreshLogs: (taskId?: number) => Promise<void>;
  /** Clear all logs */
  clearLogs: () => void;
  /** Whether loading is in progress */
  isLoading: boolean;
}

/**
 * サブタスクごとの実行ログを取得するフック
 */
export function useSubtaskLogs({
  sessionId,
  subtasks,
  pollingInterval = 3000,
  autoRefresh = true,
  sessionStatus,
}: UseSubtaskLogsOptions): UseSubtaskLogsReturn {
  const [subtaskLogs, setSubtaskLogs] = useState<Map<number, SubtaskLogState>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // サブタスクリストが変更されたら初期化
  useEffect(() => {
    const initialLogs = new Map<number, SubtaskLogState>();
    subtasks.forEach((subtask) => {
      initialLogs.set(subtask.id, {
        taskId: subtask.id,
        taskTitle: subtask.title,
        logs: [],
        isLoading: false,
        error: null,
      });
    });
    setSubtaskLogs(initialLogs);
  }, [subtasks]);

  // Fetch logs for a specific subtask
  const fetchSubtaskLogs = useCallback(
    async (taskId: number) => {
      if (!sessionId) return;

      setSubtaskLogs((prev) => {
        const current = prev.get(taskId);
        if (!current) return prev;
        const newMap = new Map(prev);
        newMap.set(taskId, { ...current, isLoading: true, error: null });
        return newMap;
      });

      try {
        const res = await fetch(
          `${API_BASE_URL}/parallel/sessions/${sessionId}/logs?taskId=${taskId}&limit=200`,
        );

        if (!res.ok) {
          throw new Error('ログの取得に失敗しました');
        }

        const result = await res.json();
        if (result.success && result.data) {
          interface RawLogEntry {
            timestamp: string;
            message?: string;
            data?: Record<string, unknown>;
            level?: 'info' | 'warn' | 'error' | 'debug';
            taskId?: number;
          }
          const logs: SubtaskLogEntry[] = result.data.map(
            (log: RawLogEntry) => ({
              timestamp: log.timestamp,
              message:
                log.message ||
                (log.data && typeof log.data === 'object'
                  ? ((log.data as Record<string, unknown>).message as string) ||
                    formatLogData(log.data)
                  : String(log.data ?? '')),
              level: log.level || 'info',
              taskId: log.taskId,
            }),
          );

          setSubtaskLogs((prev) => {
            const current = prev.get(taskId);
            if (!current) return prev;
            const newMap = new Map(prev);
            newMap.set(taskId, { ...current, logs, isLoading: false });
            return newMap;
          });
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'ログの取得に失敗しました';
        setSubtaskLogs((prev) => {
          const current = prev.get(taskId);
          if (!current) return prev;
          const newMap = new Map(prev);
          newMap.set(taskId, {
            ...current,
            isLoading: false,
            error: errorMessage,
          });
          return newMap;
        });
      }
    },
    [sessionId],
  );

  // Fetch logs for all subtasks
  const fetchAllLogs = useCallback(async () => {
    if (!sessionId || subtasks.length === 0) return;

    setIsLoading(true);
    await Promise.all(subtasks.map((subtask) => fetchSubtaskLogs(subtask.id)));
    setIsLoading(false);
  }, [sessionId, subtasks, fetchSubtaskLogs]);

  // ログを手動で更新
  const refreshLogs = useCallback(
    async (taskId?: number) => {
      if (taskId !== undefined) {
        await fetchSubtaskLogs(taskId);
      } else {
        await fetchAllLogs();
      }
    },
    [fetchSubtaskLogs, fetchAllLogs],
  );

  // Fetch logs for a specific subtask
  const getSubtaskLogs = useCallback(
    (taskId: number): SubtaskLogState | undefined => {
      return subtaskLogs.get(taskId);
    },
    [subtaskLogs],
  );

  // Clear all logs
  const clearLogs = useCallback(() => {
    setSubtaskLogs((prev) => {
      const newMap = new Map<number, SubtaskLogState>();
      prev.forEach((state, taskId) => {
        newMap.set(taskId, { ...state, logs: [], error: null });
      });
      return newMap;
    });
  }, []);

  // セッション完了時のローディング状態クリア
  useEffect(() => {
    const isCompleted =
      sessionStatus === 'completed' ||
      sessionStatus === 'failed' ||
      sessionStatus === 'cancelled';

    if (isCompleted) {
      // Clear loading state for all subtasks when completed
      setSubtaskLogs((prev) => {
        const newMap = new Map(prev);
        prev.forEach((state, taskId) => {
          newMap.set(taskId, { ...state, isLoading: false });
        });
        return newMap;
      });

      // グローバルローディング状態も解除
      setIsLoading(false);
    }
  }, [sessionStatus]);

  // Auto-refresh (polling)
  useEffect(() => {
    if (!autoRefresh || !sessionId) return;

    // If execution is completed, fetch logs one last time and stop polling
    const isCompleted =
      sessionStatus === 'completed' ||
      sessionStatus === 'failed' ||
      sessionStatus === 'cancelled';

    if (isCompleted) {
      // Fetch final logs (executed asynchronously to properly manage loading state)
      fetchAllLogs().finally(() => {
        // ログ取得完了後、ローディング状態を確実に解除
        setIsLoading(false);
        setSubtaskLogs((prev) => {
          const newMap = new Map(prev);
          prev.forEach((state, taskId) => {
            newMap.set(taskId, { ...state, isLoading: false });
          });
          return newMap;
        });
      });

      // ポーリングが動いていれば停止
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      return;
    }

    // Start polling only when execution is running
    if (sessionStatus === 'running' || sessionStatus === 'scheduled') {
      // Initial fetch
      fetchAllLogs();

      // ポーリング開始
      if (!pollingIntervalRef.current) {
        pollingIntervalRef.current = setInterval(fetchAllLogs, pollingInterval);
      }
    }

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [autoRefresh, sessionId, pollingInterval, fetchAllLogs, sessionStatus]);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  return {
    subtaskLogs,
    getSubtaskLogs,
    refreshLogs,
    clearLogs,
    isLoading,
  };
}

export default useSubtaskLogs;
