/**
 * useTaskDetailData
 *
 * Fetches all data needed by the task detail page: task, time entries,
 * comments, resources, and global user settings. Manages the skeleton
 * loading timer so the skeleton is shown for at least 400 ms.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Task, TimeEntry, Comment, Resource, UserSettings } from '@/types';
import { apiFetch, clearApiCache } from '@/lib/api-client';
import { useExecutionStateStore } from '@/stores/execution-state-store';
import { useTaskCacheStore } from '@/stores/task-cache-store';
import { preloadTaskDetails } from '@/lib/task-api';
import { recordTaskAccess } from '@/lib/cache-warmup';
import { createLogger } from '@/lib/logger';
import { useTranslations } from 'next-intl';
import type { CliAvailability } from '@/feature/developer-mode/components/ai-accordion-panel/ExecutionCapabilityGuide';

const logger = createLogger('useTaskDetailData');

/** Minimum time (ms) the skeleton must be visible on initial load. */
const SKELETON_MIN_DURATION = 400;

export interface UseTaskDetailDataParams {
  resolvedTaskId: string | null | undefined;
}

export interface UseTaskDetailDataResult {
  task: Task | null;
  setTask: React.Dispatch<React.SetStateAction<Task | null>>;
  loading: boolean;
  showSkeleton: boolean;
  error: string | null;
  timeEntries: TimeEntry[];
  setTimeEntries: React.Dispatch<React.SetStateAction<TimeEntry[]>>;
  comments: Comment[];
  setComments: React.Dispatch<React.SetStateAction<Comment[]>>;
  resources: Resource[];
  setResources: React.Dispatch<React.SetStateAction<Resource[]>>;
  globalSettings: UserSettings | null;
  /**
   * CLI availability snapshot from `/agent-availability?cliOnly=1`. Used by
   * the agent execution capability guide. Null when the probe hasn't returned
   * yet or failed — callers should treat null as "unknown" (optimistic).
   */
  cliAvailability: CliAvailability | null;
  /**
   * Force a fresh CLI availability probe (bypasses both the client and the
   * 5-min server cache). Call after an agent run ends so a CLI that falsely
   * read as unavailable mid-run is re-evaluated once the CPU is free.
   */
  refetchCliAvailability: () => Promise<void>;
  showAIAssistant: boolean;
  setShowAIAssistant: React.Dispatch<React.SetStateAction<boolean>>;
  refreshTask: () => Promise<void>;
}

/**
 * Loads all task detail page data in parallel and manages skeleton visibility.
 *
 * @param params - Contains resolvedTaskId used to build API URLs.
 * @returns Task data, loading state, and per-entity state setters.
 */
export function useTaskDetailData({
  resolvedTaskId,
}: UseTaskDetailDataParams): UseTaskDetailDataResult {
  const t = useTranslations('task');

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [globalSettings, setGlobalSettings] = useState<UserSettings | null>(null);
  const [cliAvailability, setCliAvailability] = useState<CliAvailability | null>(null);
  const [showAIAssistant, setShowAIAssistant] = useState(false);

  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skeletonStartRef = useRef<number>(Date.now());
  const taskLoadedRef = useRef(false);

  const fetchTask = async (isInitialLoad: boolean) => {
    try {
      // Seed from the already-loaded task list so the detail renders IMMEDIATELY
      // instead of holding a skeleton while the network fetch is in flight. When
      // the backend is momentarily busy (e.g. an agent run doing git/worktree
      // work) that fetch can take seconds, which is the "selected task stays on
      // 読み込み中 then appears" symptom. The fresh fetch below still revalidates
      // (covers post-split subtask changes the cached list might miss).
      const seed =
        isInitialLoad && resolvedTaskId
          ? useTaskCacheStore
              .getState()
              .tasks.find((cachedTask) => cachedTask.id === parseInt(resolvedTaskId, 10))
          : undefined;
      if (seed) {
        setTask(seed);
        taskLoadedRef.current = true;
        setLoading(false);
        setShowSkeleton(false);
      } else if (isInitialLoad) {
        setLoading(true);
        setShowSkeleton(true);
        skeletonStartRef.current = Date.now();
      }
      // NOTE: The focused task must always reflect current server state — most
      // importantly subtasks created by background workflow execution after this
      // task was last cached. The shared /tasks/:id cache is 24h and persisted to
      // localStorage, so without invalidating here the detail view can render a
      // stale task whose `subtasks` array predates a server-side split (the list
      // view uses a different cache key and looked correct). Revalidate fresh.
      if (resolvedTaskId) {
        clearApiCache(`/tasks/${resolvedTaskId}`);
      }
      const data = await apiFetch<Task>(`/tasks/${resolvedTaskId}`, {
        cacheTime: 24 * 60 * 60 * 1000,
      });
      setTask(data);
      taskLoadedRef.current = true;

      if (resolvedTaskId) {
        const numericId = parseInt(resolvedTaskId, 10);
        if (!isNaN(numericId)) {
          recordTaskAccess(numericId);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fetchFailed'));
    } finally {
      if (isInitialLoad) {
        setLoading(false);
        const elapsed = Date.now() - skeletonStartRef.current;
        const remaining = SKELETON_MIN_DURATION - elapsed;
        if (remaining > 0) {
          skeletonTimerRef.current = setTimeout(() => {
            setShowSkeleton(false);
          }, remaining);
        } else {
          setShowSkeleton(false);
        }
      }
    }
  };

  /** Re-fetches task without affecting skeleton state. */
  const refreshTask = async () => {
    if (!resolvedTaskId) return;
    try {
      clearApiCache(`/tasks/${resolvedTaskId}`);
      const data = await apiFetch<Task>(`/tasks/${resolvedTaskId}`, {
        cacheTime: 24 * 60 * 60 * 1000,
      });
      setTask(data);
    } catch (err) {
      logger.error('Failed to refresh task:', err);
    }
  };

  // refresh=1 forces the backend to re-probe and invalidate its cache; skipCache
  // bypasses the 60s client cache so the fresh result is applied immediately.
  const refetchCliAvailability = useCallback(async () => {
    try {
      const data = await apiFetch<CliAvailability>('/agent-availability?cliOnly=1&refresh=1', {
        skipCache: true,
      });
      setCliAvailability(data);
    } catch (err) {
      logger.error('Failed to refresh CLI availability:', err);
    }
  }, []);

  // Re-probe the CLI the moment THIS task's agent run ends. The probe can time
  // out under the run's CPU load and cache `available:false`, which disables the
  // run button + shows the "CLI 利用可能ではありません" guide afterwards; once the
  // CPU frees up a forced re-probe corrects it without waiting for the cache.
  const numericTaskId = resolvedTaskId ? parseInt(resolvedTaskId, 10) : NaN;
  const isAgentExecuting = useExecutionStateStore((s) =>
    Number.isNaN(numericTaskId) ? false : s.isTaskExecuting(numericTaskId),
  );
  const wasExecutingRef = useRef(false);
  useEffect(() => {
    if (wasExecutingRef.current && !isAgentExecuting) {
      void refetchCliAvailability();
    }
    wasExecutingRef.current = isAgentExecuting;
  }, [isAgentExecuting, refetchCliAvailability]);

  useEffect(() => {
    const isInitialLoad = !taskLoadedRef.current;

    const fetchTimeEntries = async () => {
      try {
        const data = await apiFetch<TimeEntry[]>(`/tasks/${resolvedTaskId}/time-entries`, {
          cacheTime: 60 * 60 * 1000,
        });
        setTimeEntries(data);
      } catch (err) {
        logger.error('Failed to fetch time entries:', err);
      }
    };

    const fetchComments = async () => {
      try {
        const data = await apiFetch<Comment[]>(`/tasks/${resolvedTaskId}/comments`, {
          cacheTime: 60 * 60 * 1000,
        });
        setComments(data);
      } catch (err) {
        logger.error('Failed to fetch comments:', err);
      }
    };

    const fetchResources = async () => {
      try {
        const data = await apiFetch<Resource[]>(`/tasks/${resolvedTaskId}/resources`, {
          cacheTime: 60 * 60 * 1000,
        });
        setResources(data);
      } catch (err) {
        logger.error('Failed to fetch resources:', err);
      }
    };

    const fetchGlobalSettings = async () => {
      try {
        const data = await apiFetch<UserSettings>('/settings', {
          cacheTime: 6 * 60 * 60 * 1000,
        });
        setGlobalSettings(data);
        if (data.aiTaskAnalysisDefault) {
          setShowAIAssistant(true);
        }
      } catch (err) {
        logger.error('Failed to fetch global settings:', err);
      }
    };

    // NOTE: Probe whether claude / codex / gemini CLIs are reachable.
    // The backend caches this for 5 minutes so polling per-task is cheap.
    // A failure leaves cliAvailability=null which the capability guide
    // treats as "unknown / optimistic ready" — execution itself will surface
    // a clear error if no CLI is actually installed.
    const fetchCliAvailability = async () => {
      try {
        const data = await apiFetch<CliAvailability>('/agent-availability?cliOnly=1', {
          cacheTime: 60 * 1000,
        });
        setCliAvailability(data);
      } catch (err) {
        logger.error('Failed to fetch CLI availability:', err);
      }
    };

    if (resolvedTaskId) {
      Promise.all([
        fetchTask(isInitialLoad),
        fetchTimeEntries(),
        fetchComments(),
        fetchResources(),
        fetchGlobalSettings(),
        fetchCliAvailability(),
      ]);
    }

    return () => {
      if (skeletonTimerRef.current) {
        clearTimeout(skeletonTimerRef.current);
        skeletonTimerRef.current = null;
      }
    };
  }, [resolvedTaskId]);

  // NOTE: Fallback safety for skeleton display.
  // If main useEffect re-triggers and clears the timer,
  // ensure showSkeleton is set to false when loading completes.
  useEffect(() => {
    if (!loading && showSkeleton && taskLoadedRef.current) {
      setShowSkeleton(false);
    }
  }, [loading, showSkeleton]);

  // Preload subtask details after task is loaded
  useEffect(() => {
    if (task?.subtasks && task.subtasks.length > 0) {
      const subtaskIds = task.subtasks.map((s) => s.id);
      preloadTaskDetails(subtaskIds);
    }
  }, [task?.subtasks]);

  return {
    task,
    setTask,
    loading,
    showSkeleton,
    error,
    timeEntries,
    setTimeEntries,
    comments,
    setComments,
    resources,
    setResources,
    globalSettings,
    cliAvailability,
    refetchCliAvailability,
    showAIAssistant,
    setShowAIAssistant,
    refreshTask,
  };
}
