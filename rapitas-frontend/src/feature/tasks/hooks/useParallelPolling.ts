'use client';

/**
 * useParallelPolling
 *
 * Manages polling-based status updates for a parallel execution session.
 * Used as a fallback when the SSE connection is unavailable or drops.
 */

import { useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type {
  ParallelSessionState,
  SubtaskExecutionState,
} from './parallel-execution-types';
import type { ParallelExecutionStatus } from '../components/SubtaskExecutionStatus';

const logger = createLogger('useParallelPolling');

interface UseParallelPollingOptions {
  /** Ref that always holds the current sessionId to avoid stale closures */
  sessionIdRef: React.RefObject<string | null>;
  /** React state setter for the session state */
  setSessionState: React.Dispatch<
    React.SetStateAction<ParallelSessionState | null>
  >;
}

/**
 * Provides fetchStatus (single poll) and polling interval management.
 *
 * @param options - sessionIdRef and setSessionState / セッションIDの参照と状態セッター
 * @returns fetchStatus callback and interval ref
 */
export function useParallelPolling({
  sessionIdRef,
  setSessionState,
}: UseParallelPollingOptions) {
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // NOTE: Uses ref to prevent stale closure references when called from onerror
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
          const newSubtaskStates = new Map<number, SubtaskExecutionState>(
            prev?.subtaskStates || new Map(),
          );

          data.completed?.forEach((id: number) => {
            newSubtaskStates.set(id, {
              ...newSubtaskStates.get(id),
              taskId: id,
              status: 'completed' as ParallelExecutionStatus,
            });
          });

          data.running?.forEach((id: number) => {
            if (newSubtaskStates.get(id)?.status !== 'completed') {
              newSubtaskStates.set(id, {
                ...newSubtaskStates.get(id),
                taskId: id,
                status: 'running' as ParallelExecutionStatus,
              });
            }
          });

          data.failed?.forEach((id: number) => {
            newSubtaskStates.set(id, {
              ...newSubtaskStates.get(id),
              taskId: id,
              status: 'failed' as ParallelExecutionStatus,
            });
          });

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
                status: 'blocked' as ParallelExecutionStatus,
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
  }, [sessionIdRef, setSessionState]);

  const startPolling = useCallback(
    (intervalMs: number) => {
      if (pollingIntervalRef.current) return;
      pollingIntervalRef.current = setInterval(fetchStatus, intervalMs);
    },
    [fetchStatus],
  );

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  return { fetchStatus, startPolling, stopPolling, pollingIntervalRef };
}
