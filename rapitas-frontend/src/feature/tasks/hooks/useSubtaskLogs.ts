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
  sessionStatus?: 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled' | 'blocked';
}

interface UseSubtaskLogsReturn {
  /** サブタスクごとのログ状態 */
  subtaskLogs: Map<number, SubtaskLogState>;
  /** 特定のサブタスクのログを取得 */
  getSubtaskLogs: (taskId: number) => SubtaskLogState | undefined;
  /** ログを手動で更新 */
  refreshLogs: (taskId?: number) => Promise<void>;
  /** 全ログをクリア */
  clearLogs: () => void;
  /** 読み込み中かどうか */
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

  // 特定のサブタスクのログを取得
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
            data?: { message?: string };
            level?: 'info' | 'warn' | 'error' | 'debug';
            taskId?: number;
          }
          const logs: SubtaskLogEntry[] = result.data.map(
            (log: RawLogEntry) => ({
              timestamp: log.timestamp,
              message:
                log.message || log.data?.message || JSON.stringify(log.data),
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

  // 全てのサブタスクのログを取得
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

  // 特定のサブタスクのログを取得
  const getSubtaskLogs = useCallback(
    (taskId: number): SubtaskLogState | undefined => {
      return subtaskLogs.get(taskId);
    },
    [subtaskLogs],
  );

  // 全ログをクリア
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
    const isCompleted = sessionStatus === 'completed' || sessionStatus === 'failed' || sessionStatus === 'cancelled';

    if (isCompleted) {
      // 完了時は全サブタスクのローディング状態を確実に解除
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

  // 自動更新（ポーリング）
  useEffect(() => {
    if (!autoRefresh || !sessionId) return;

    // 実行が完了している場合は最後に一度だけログを取得してポーリング停止
    const isCompleted = sessionStatus === 'completed' || sessionStatus === 'failed' || sessionStatus === 'cancelled';

    if (isCompleted) {
      // 最終的なログを取得（非同期で実行してローディング状態を適切に管理）
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

    // 実行中の場合のみポーリング開始
    if (sessionStatus === 'running' || sessionStatus === 'scheduled') {
      // 初回取得
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
