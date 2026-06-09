/**
 * useThemeAutoRun
 *
 * Fetches and controls the auto-run state for a single theme.
 * Polls at 8s when auto-run is active (running/paused/stopping).
 * Falls back to manual refresh when idle.
 */
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE_URL } from '@/utils/api';

export type AutoRunStatus = 'idle' | 'running' | 'paused' | 'stopping';

export interface ThemeAutoRunState {
  id: number;
  themeId: number;
  enabled: boolean;
  status: AutoRunStatus;
  order: 'priority' | 'created';
  currentTaskId: number | null;
  processedCount: number;
  lastError: string | null;
  lastRunAt: string | null;
  startedAt: string | null;
  updatedAt: string;
}

interface CurrentTask {
  id: number;
  title: string;
  status: string;
  workflowStatus: string | null;
}

interface AutoRunData {
  autoRun: ThemeAutoRunState;
  currentTask: CurrentTask | null;
  remainingCount: number;
}

/** Minimum polling interval when auto-run is active (ms). */
const ACTIVE_POLL_MS = 8_000;

/**
 * Hook for managing theme auto-run state and sending control actions.
 *
 * @param themeId - Theme to control; null/undefined → returns idle state
 * @param isDevelopment - Whether the theme supports execution / 実行可能テーマか
 * @returns auto-run data, loading state, error, and action handlers
 */
export function useThemeAutoRun(themeId: number | null | undefined, isDevelopment?: boolean) {
  const [data, setData] = useState<AutoRunData | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPoll = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const fetchState = useCallback(async () => {
    if (!themeId || !isDevelopment) return;
    try {
      const res = await fetch(`${API_BASE_URL}/themes/${themeId}/auto-run`);
      if (!res.ok) return;
      const json = (await res.json()) as { success: boolean } & Partial<AutoRunData>;
      if (json.success && json.autoRun) {
        setData({
          autoRun: json.autoRun,
          currentTask: json.currentTask ?? null,
          remainingCount: json.remainingCount ?? 0,
        });
      }
    } catch {
      // Network error — non-fatal, next poll will retry
    }
  }, [themeId, isDevelopment]);

  // Initial load and polling setup
  useEffect(() => {
    clearPoll();
    if (!themeId || !isDevelopment) {
      setData(null);
      return;
    }

    setLoading(true);
    fetchState().finally(() => setLoading(false));

    // Start polling; adjust interval based on active status
    pollTimer.current = setInterval(fetchState, ACTIVE_POLL_MS);

    return () => clearPoll();
  }, [themeId, isDevelopment, fetchState]);

  const sendAction = useCallback(
    async (action: 'start' | 'pause' | 'stop', order?: 'priority' | 'created') => {
      if (!themeId) return;
      setActionLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/themes/${themeId}/auto-run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, order }),
        });
        const json = (await res.json()) as {
          success: boolean;
          error?: string;
          autoRun?: ThemeAutoRunState;
        };
        if (!json.success) {
          setError(json.error ?? 'Auto-run action failed');
        } else {
          // Optimistically update state then re-fetch
          if (json.autoRun) {
            setData((prev) =>
              prev
                ? { ...prev, autoRun: json.autoRun! }
                : { autoRun: json.autoRun!, currentTask: null, remainingCount: 0 },
            );
          }
          // Re-fetch full data after short delay
          setTimeout(fetchState, 500);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
      } finally {
        setActionLoading(false);
      }
    },
    [themeId, fetchState],
  );

  return {
    data,
    loading,
    actionLoading,
    error,
    start: (order?: 'priority' | 'created') => sendAction('start', order),
    pause: () => sendAction('pause'),
    stop: () => sendAction('stop'),
    refresh: fetchState,
  };
}
