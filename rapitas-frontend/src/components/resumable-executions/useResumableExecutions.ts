/**
 * use-resumable-executions
 *
 * Custom hook that manages fetching, polling, auto-resume, and action handlers
 * for resumable task executions. Keeps the banner component focused on rendering.
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL, fetchWithRetry } from '@/utils/api';
import { useBackendHealth } from '@/hooks/common/useBackendHealth';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { createLogger } from '@/lib/logger';
import type { ResumableExecution } from './types';

const logger = createLogger('useResumableExecutions');

// Prevents auto-resume from firing more than once per browser session
const AUTO_RESUME_SESSION_KEY = 'rapitas_auto_resume_triggered';

export interface UseResumableExecutionsReturn {
  executions: ResumableExecution[];
  isLoading: boolean;
  isDismissed: boolean;
  resumingIds: Set<number>;
  dismissingIds: Set<number>;
  connectionError: Error | null;
  isConnected: boolean;
  isIntentionalRestart: boolean;
  runningCount: number;
  interruptedCount: number;
  setIsDismissed: (v: boolean) => void;
  setConnectionError: (e: Error | null) => void;
  fetchResumableExecutions: () => Promise<ResumableExecution[]>;
  handleResume: (executionId: number, isAutoResume?: boolean) => Promise<void>;
  handleDismiss: (executionId: number) => Promise<void>;
  handleDismissAll: () => Promise<void>;
  handleResumeAll: () => Promise<void>;
  formatTimeAgo: (dateString: string) => string;
}

/**
 * Provides all data-fetching, polling, and action logic for resumable executions.
 *
 * @returns State, derived counts, and action handlers for the banner component.
 */
export function useResumableExecutions(): UseResumableExecutionsReturn {
  const tc = useTranslations('common');
  const tNotification = useTranslations('notification');
  const t = useTranslations('banner');

  const [executions, setExecutions] = useState<ResumableExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDismissed, setIsDismissed] = useState(false);
  const [resumingIds, setResumingIds] = useState<Set<number>>(new Set());
  const [dismissingIds, setDismissingIds] = useState<Set<number>>(new Set());
  const [autoResume, setAutoResume] = useState(false);
  const [connectionError, setConnectionError] = useState<Error | null>(null);

  const autoResumeCheckedRef = useRef(false);
  const disconnectTimerRef = useRef<number | null>(null);
  const executingTasksSize = useExecutionStateStore(
    (state) => state.executingTasks.size,
  );

  const fetchAutoResumeSetting = useCallback(async () => {
    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/settings`,
        undefined,
        2,
        500,
        10000,
        { silent: true },
      );
      if (res.ok) {
        const data = await res.json();
        setAutoResume(data.autoResumeInterruptedTasks ?? false);
      }
    } catch {
      setAutoResume(false);
    }
  }, []);

  const fetchResumableExecutions = useCallback(async () => {
    try {
      setConnectionError(null);
      const res = await fetchWithRetry(
        `${API_BASE_URL}/agents/resumable-executions`,
        undefined,
        2,
        500,
        5000,
        { silent: true },
      );
      if (res.ok) {
        const data: ResumableExecution[] = await res.json();
        setExecutions((prev) => {
          const prevIds = new Set(prev.map((e) => e.id));
          // Reset dismissed only when genuinely new executions arrive
          if (data.some((e) => !prevIds.has(e.id)) && data.length > 0)
            setIsDismissed(false);
          return data;
        });
        return data;
      } else {
        logger.warn(
          `Failed to fetch resumable executions: ${res.status} ${res.statusText}`,
        );
        setExecutions([]);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to fetch resumable executions: ${errMsg}`);
      setConnectionError(
        error instanceof Error ? error : new Error(String(error)),
      );
      setExecutions([]);
    } finally {
      setIsLoading(false);
    }
    return [];
  }, []);

  const { isConnected, isIntentionalRestart } = useBackendHealth({
    onReconnectAction: () => {
      logger.info('Backend reconnected, re-fetching executions');
      // NOTE: Cancel pending disconnect error timer (server came back before the delay)
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      setIsLoading(true);
      setConnectionError(null);
      fetchResumableExecutions();
      // NOTE: Also refresh filter data (categories/themes) which may have errored during restart
      import('@/stores/filter-data-store')
        .then(({ useFilterDataStore }) => {
          useFilterDataStore.getState().refreshData(true);
        })
        .catch(() => {});
    },
    onDisconnectAction: () => {
      logger.info('Backend disconnected');
      // NOTE: Delay error display by 10 seconds to suppress toast during intentional manual restarts.
      // If the server comes back within this window, onReconnectAction clears the error.
      disconnectTimerRef.current = window.setTimeout(() => {
        setConnectionError(new Error(t('backendDisconnected')));
      }, 10000);
    },
  });

  // Run initial fetch once the backend connection is confirmed
  const initialFetchDoneRef = useRef(false);
  useEffect(() => {
    if (!isConnected || initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;
    fetchAutoResumeSetting();
    fetchResumableExecutions();
  }, [isConnected, fetchAutoResumeSetting, fetchResumableExecutions]);

  // Re-fetch immediately when new executing tasks appear in the global store
  const prevExecutingTasksSizeRef = useRef(executingTasksSize);
  useEffect(() => {
    if (executingTasksSize > prevExecutingTasksSizeRef.current && isConnected)
      fetchResumableExecutions();
    prevExecutingTasksSizeRef.current = executingTasksSize;
  }, [executingTasksSize, isConnected, fetchResumableExecutions]);

  // Periodic polling — 10 s while tasks are running, 15 s otherwise
  useEffect(() => {
    if (isDismissed || !isConnected) return;
    const hasRunning = executions.some(
      (e) => e.status === 'running' || e.status === 'waiting_for_input',
    );
    const interval = setInterval(
      () => {
        if (isConnected) fetchResumableExecutions();
      },
      hasRunning ? 10000 : 15000,
    );
    return () => clearInterval(interval);
  }, [executions, isDismissed, isConnected, fetchResumableExecutions]);

  // Auto-resume — runs at most once per session
  useEffect(() => {
    if (autoResumeCheckedRef.current || isLoading) return;
    autoResumeCheckedRef.current = true;
    const resumable = executions.filter((e) => e.canResume);
    if (!autoResume || resumable.length === 0) return;
    if (sessionStorage.getItem(AUTO_RESUME_SESSION_KEY) === 'true') return;
    logger.info(`Starting auto-resume for ${resumable.length} executions`);
    sessionStorage.setItem(AUTO_RESUME_SESSION_KEY, 'true');
    (async () => {
      for (const exec of resumable) await handleResume(exec.id, true);
    })();
  }, [autoResume, isLoading, executions]);

  const handleResume = async (executionId: number, isAutoResume = false) => {
    setResumingIds((prev) => new Set(prev).add(executionId));
    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/agents/executions/${executionId}/resume`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      if (res.ok) {
        const data = await res.json();
        setExecutions((prev) => prev.filter((e) => e.id !== executionId));
        if (!isAutoResume && data.taskId) {
          // Brief delay to let the backend start processing before redirecting
          await new Promise((resolve) => setTimeout(resolve, 500));
          window.location.href = `/tasks/${data.taskId}?showHeader=true`;
        }
      } else {
        logger.error(
          `Failed to resume execution: ${res.status} ${res.statusText}`,
        );
        if (!isAutoResume) alert(`${tc('errorOccurred')}: ${res.status}`);
      }
    } catch (error) {
      logger.warn('Error resuming execution:', error);
    } finally {
      setResumingIds((prev) => {
        const next = new Set(prev);
        next.delete(executionId);
        return next;
      });
    }
  };

  const handleDismiss = async (executionId: number) => {
    const exec = executions.find((e) => e.id === executionId);
    if (
      exec &&
      (exec.status === 'running' || exec.status === 'waiting_for_input')
    ) {
      // Running tasks are removed client-side only — do not acknowledge on the backend
      setExecutions((prev) => prev.filter((e) => e.id !== executionId));
      return;
    }
    setDismissingIds((prev) => new Set(prev).add(executionId));
    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/agents/executions/${executionId}/acknowledge`,
        { method: 'POST' },
      );
      if (res.ok)
        setExecutions((prev) => prev.filter((e) => e.id !== executionId));
      else
        logger.error(
          `Failed to dismiss execution: ${res.status} ${res.statusText}`,
        );
    } catch (error) {
      logger.warn('Error dismissing execution:', error);
    } finally {
      setDismissingIds((prev) => {
        const next = new Set(prev);
        next.delete(executionId);
        return next;
      });
    }
  };

  const handleDismissAll = async () => {
    for (const exec of executions) await handleDismiss(exec.id);
    setIsDismissed(true);
  };

  const handleResumeAll = async () => {
    for (const exec of executions)
      if (exec.canResume) await handleResume(exec.id, true);
  };

  /**
   * Converts an ISO date string to a localised relative-time label.
   *
   * @param dateString - ISO 8601 date string.
   * @returns Localised relative time string (e.g. "3分前").
   */
  const formatTimeAgo = (dateString: string) => {
    const diffMs = Date.now() - new Date(dateString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) return tNotification('daysAgo', { count: diffDays });
    if (diffHours > 0) return tNotification('hoursAgo', { count: diffHours });
    if (diffMins > 0) return tNotification('minutesAgo', { count: diffMins });
    return tNotification('justNow');
  };

  const runningCount = executions.filter(
    (e) => e.status === 'running' || e.status === 'waiting_for_input',
  ).length;
  const interruptedCount = executions.filter(
    (e) => e.status === 'interrupted',
  ).length;

  return {
    executions,
    isLoading,
    isDismissed,
    resumingIds,
    dismissingIds,
    connectionError,
    isConnected,
    isIntentionalRestart,
    runningCount,
    interruptedCount,
    setIsDismissed,
    setConnectionError,
    fetchResumableExecutions,
    handleResume,
    handleDismiss,
    handleDismissAll,
    handleResumeAll,
    formatTimeAgo,
  };
}
