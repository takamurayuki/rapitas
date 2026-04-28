'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';

/**
 * Subtask log entry
 */
export interface SubtaskLogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  taskId?: number;
}

/**
 * Format data object into a human-readable string
 */
export function formatLogData(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return String(data);

  const obj = data as Record<string, unknown>;

  // Extract and format commonly used fields first
  const parts: string[] = [];

  // Message fields
  const msgField = obj.message || obj.msg || obj.description || obj.text;
  if (msgField && typeof msgField === 'string') {
    parts.push(msgField);
  }

  // Status fields
  if (obj.status && typeof obj.status === 'string') {
    parts.push(`ステータス: ${obj.status}`);
  }

  // Type fields
  if (obj.type && typeof obj.type === 'string') {
    parts.push(`タイプ: ${obj.type}`);
  }

  // Error fields
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
 * Subtask log state
 */
export interface SubtaskLogState {
  taskId: number;
  taskTitle: string;
  logs: SubtaskLogEntry[];
  isLoading: boolean;
  error: string | null;
}

interface UseSubtaskLogsOptions {
  /** Parallel execution session ID */
  sessionId: string | null;
  /** Subtask list (ID and title) */
  subtasks: Array<{ id: number; title: string }>;
  /** Polling interval in milliseconds */
  pollingInterval?: number;
  /** Whether to enable auto-refresh */
  autoRefresh?: boolean;
  /** Parallel execution session state */
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
 * Hook to fetch execution logs per subtask
 */
export function useSubtaskLogs({
  sessionId,
  subtasks,
  pollingInterval = 3000,
  autoRefresh = true,
  sessionStatus,
}: UseSubtaskLogsOptions): UseSubtaskLogsReturn {
  const [subtaskLogs, setSubtaskLogs] = useState<Map<number, SubtaskLogState>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize when subtask list changes
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
          const logs: SubtaskLogEntry[] = result.data.map((log: RawLogEntry) => ({
            timestamp: log.timestamp,
            message:
              log.message ||
              (log.data && typeof log.data === 'object'
                ? ((log.data as Record<string, unknown>).message as string) ||
                  formatLogData(log.data)
                : String(log.data ?? '')),
            level: log.level || 'info',
            taskId: log.taskId,
          }));

          setSubtaskLogs((prev) => {
            const current = prev.get(taskId);
            if (!current) return prev;
            const newMap = new Map(prev);
            newMap.set(taskId, { ...current, logs, isLoading: false });
            return newMap;
          });
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'ログの取得に失敗しました';
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

  // Manually refresh logs
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

  // Clear loading state on session completion
  useEffect(() => {
    const isCompleted =
      sessionStatus === 'completed' || sessionStatus === 'failed' || sessionStatus === 'cancelled';

    if (isCompleted) {
      // Clear loading state for all subtasks when completed
      setSubtaskLogs((prev) => {
        const newMap = new Map(prev);
        prev.forEach((state, taskId) => {
          newMap.set(taskId, { ...state, isLoading: false });
        });
        return newMap;
      });

      setIsLoading(false);
    }
  }, [sessionStatus]);

  // Auto-refresh (polling)
  useEffect(() => {
    if (!autoRefresh || !sessionId) return;

    // If execution is completed, fetch logs one last time and stop polling
    const isCompleted =
      sessionStatus === 'completed' || sessionStatus === 'failed' || sessionStatus === 'cancelled';

    if (isCompleted) {
      // Fetch final logs (executed asynchronously to properly manage loading state)
      fetchAllLogs().finally(() => {
        // Ensure loading state is cleared after log fetch
        setIsLoading(false);
        setSubtaskLogs((prev) => {
          const newMap = new Map(prev);
          prev.forEach((state, taskId) => {
            newMap.set(taskId, { ...state, isLoading: false });
          });
          return newMap;
        });
      });

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

      // Start polling
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

  // Cleanup
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
