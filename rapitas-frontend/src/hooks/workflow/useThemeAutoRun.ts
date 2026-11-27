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
import { useOnVisible } from '@/hooks/common/useOnVisible';
import { getAppHidden, subscribeAppHidden } from '@/hooks/common/app-visibility-store';
import { resolvePollInterval, usePollHidden } from '@/hooks/common/poll-interval';

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

/** The task auto-run is working on, as the state endpoint returns it. */
export interface CurrentTask {
  id: number;
  title: string;
  status: string;
  workflowStatus: string | null;
  /** lightweight / standard / comprehensive; absent from older backends. */
  workflowMode?: string | null;
  /** Send-backs to an earlier phase, or null when none. */
  rework?: ReworkSummary | null;
  /**
   * Other tasks of the theme running in parallel with this one (task 1552),
   * copied from the response's `activeTasks`; absent or empty = one at a time.
   */
  companions?: ActiveTask[];
}

/** One running task of the theme, head first (task 1552). */
export interface ActiveTask {
  id: number;
  title: string;
  /** `head` = currentTask, `companion` = a 2nd+ task running alongside it. */
  role: 'head' | 'companion';
}

/** How often the task was sent back, and the most recent send-back. */
export interface ReworkSummary {
  count: number;
  lastFromStatus: string;
  lastToStatus: string;
  lastCause: string;
  lastAt: string;
}

/** Auto-run state plus the current task and the remaining backlog count. */
export interface AutoRunData {
  autoRun: ThemeAutoRunState;
  currentTask: CurrentTask | null;
  remainingCount: number;
  /** Every running task of the theme (task 1552); absent from older backends. */
  activeTasks?: ActiveTask[];
  /** True while auto-run starts no new work until merged code activates (task 1562). */
  restartWait?: boolean;
  /** Updates waiting to activate; null when unknown. / 取り込み待ちの件数 */
  pendingUpdateCount?: number | null;
}

/**
 * Attach the companions to the head so the progress strip, which receives only
 * the current task, can show parallel work.
 *
 * @param currentTask - Head task from the response / 先頭タスク
 * @param activeTasks - Every running task / 動作中の全タスク
 * @returns The head with its companions, or null / 同伴タスク付きの先頭
 */
export function withCompanions(
  currentTask: CurrentTask | null,
  activeTasks: ActiveTask[] | undefined,
): CurrentTask | null {
  if (!currentTask) return null;
  const companions = (activeTasks ?? []).filter((a) => a.role === 'companion');
  return companions.length > 0 ? { ...currentTask, companions } : currentTask;
}

/** What the hook returns, so one call can feed several components. */
export type ThemeAutoRunControl = ReturnType<typeof useThemeAutoRun>;

/** Minimum polling interval when auto-run is active (ms). */
const ACTIVE_POLL_MS = 8_000;

/**
 * How long an action keeps retrying while the backend cannot be reached (ms).
 * The backend restarts itself to apply new commits (dev.js, exit code 75); a
 * restart takes from a few seconds to about a minute.
 */
export const AUTO_RUN_ACTION_RETRY_MS = 90_000;

/** `error` value when the server stayed unreachable for the whole retry window. */
export const AUTO_RUN_ERROR_UNREACHABLE = 'unreachable';

type ActionResponse = { success: boolean; error?: string; autoRun?: ThemeAutoRunState };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * POST an auto-run action, retrying while the backend is down or still starting.
 *
 * NOTE: Added 2026-11-21. 再開 pressed during a backend restart failed once
 * with "Failed to fetch" and the run stayed paused. Retrying is safe because
 * all three actions are idempotent: start is a no-op when already running,
 * pause and stop write the same status again.
 *
 * @param themeId - Theme to act on / 対象テーマID
 * @param action - start / pause / stop / 操作
 * @param order - Selection order for start / 開始時の選択順
 * @param onRetrying - Told when retrying starts / 再試行中かを通知する
 * @returns The response body, or null when the server stayed unreachable / 応答本文（接続できなければ null）
 */
async function postActionWithRetry(
  themeId: number,
  action: 'start' | 'pause' | 'stop',
  order: 'priority' | 'created' | undefined,
  onRetrying: (retrying: boolean) => void,
): Promise<ActionResponse | null> {
  const deadline = Date.now() + AUTO_RUN_ACTION_RETRY_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}/themes/${themeId}/auto-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, order }),
      });
      // 502-504 come from a backend that is going down or not yet serving;
      // any other status is the handler's own answer and is returned as is.
      if (!(res.status >= 502 && res.status <= 504)) return (await res.json()) as ActionResponse;
    } catch (err) {
      // fetch rejects with TypeError when nothing answers on the port.
      if (!(err instanceof TypeError)) throw err;
    }
    if (Date.now() >= deadline) return null;
    onRetrying(true);
    await sleep(Math.min(1_000 * 2 ** attempt, 5_000));
  }
}

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
  // True while an action waits for a restarting backend to come back.
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hidden = usePollHidden();

  const clearPoll = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const fetchState = useCallback(async () => {
    if (!themeId || !isDevelopment) return;
    // Skip while in tray — saves a network round-trip; useOnVisible re-checks on return.
    // getAppHidden() covers minimize, which occlusion-disabled WebView2 doesn't
    // report via document.hidden.
    if ((typeof document !== 'undefined' && document.hidden) || getAppHidden()) return;
    try {
      const res = await fetch(`${API_BASE_URL}/themes/${themeId}/auto-run`);
      if (!res.ok) return;
      const json = (await res.json()) as { success: boolean } & Partial<AutoRunData>;
      if (json.success && json.autoRun) {
        setData({
          autoRun: json.autoRun,
          currentTask: withCompanions(json.currentTask ?? null, json.activeTasks),
          remainingCount: json.remainingCount ?? 0,
          activeTasks: json.activeTasks,
          restartWait: json.restartWait === true,
          pendingUpdateCount:
            typeof json.pendingUpdateCount === 'number' ? json.pendingUpdateCount : null,
        });
      }
    } catch {
      // Network error — non-fatal, next poll will retry
    }
  }, [themeId, isDevelopment]);

  // Initial load whenever the target theme changes.
  useEffect(() => {
    if (!themeId || !isDevelopment) {
      setData(null);
      return;
    }
    setLoading(true);
    fetchState().finally(() => setLoading(false));
  }, [themeId, isDevelopment, fetchState]);

  // Polling: 8 s while visible, stretched while backgrounded (task 1553). Kept
  // apart from the initial load so going to / returning from the background
  // only re-arms the timer instead of flashing the loading state.
  useEffect(() => {
    clearPoll();
    if (!themeId || !isDevelopment) return;
    pollTimer.current = setInterval(fetchState, resolvePollInterval(ACTIVE_POLL_MS, hidden));
    return () => clearPoll();
  }, [themeId, isDevelopment, fetchState, hidden]);

  // Re-fetch immediately when the user returns from tray/another app.
  useOnVisible(fetchState);

  // Re-fetch immediately on restore from minimize. visibilitychange (behind
  // useOnVisible above) never fires for that transition because occlusion is
  // intentionally disabled, so without this the 8s poll interval would be
  // the only thing to pick it back up.
  useEffect(
    () =>
      subscribeAppHidden(() => {
        if (!getAppHidden()) fetchState();
      }),
    [fetchState],
  );

  const sendAction = useCallback(
    async (action: 'start' | 'pause' | 'stop', order?: 'priority' | 'created') => {
      if (!themeId) return;
      setActionLoading(true);
      setError(null);
      try {
        const json = await postActionWithRetry(themeId, action, order, setReconnecting);
        if (!json) {
          setError(AUTO_RUN_ERROR_UNREACHABLE);
        } else if (!json.success) {
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
        setReconnecting(false);
        setActionLoading(false);
      }
    },
    [themeId, fetchState],
  );

  return {
    data,
    loading,
    actionLoading,
    reconnecting,
    error,
    start: (order?: 'priority' | 'created') => sendAction('start', order),
    pause: () => sendAction('pause'),
    stop: () => sendAction('stop'),
    refresh: fetchState,
  };
}
