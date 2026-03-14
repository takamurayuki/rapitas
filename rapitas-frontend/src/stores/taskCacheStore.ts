import { create } from 'zustand';
import type { Task, Status } from '@/types';
import { API_BASE_URL, fetchWithRetry } from '@/utils/api';
import { createLogger } from '@/lib/logger';
const logger = createLogger('taskCacheStore');

type ConnectionStatus = 'online' | 'offline' | 'reconnecting';

type TaskCacheState = {
  tasks: Task[];
  lastFetchedAt: string | null;
  loading: boolean;
  initialized: boolean;
  connectionStatus: ConnectionStatus;
  consecutiveFailures: number;
  lastError: string | null;

  /** Initial full fetch — call once on mount */
  fetchAll: () => Promise<void>;

  /** Incremental fetch — only updated tasks since last fetch + detect deletions via count */
  fetchUpdates: (silent?: boolean) => Promise<void>;

  /** Optimistic local updates (for quick UI feedback) */
  updateTaskLocally: (id: number, patch: Partial<Task>) => void;
  removeTaskLocally: (id: number) => void;
  addTaskLocally: (task: Task) => void;
  setTasks: (tasks: Task[]) => void;
};

/** Max consecutive failures before suppressing repeated error logs */
const MAX_LOGGED_FAILURES = 3;

export const useTaskCacheStore = create<TaskCacheState>()((set, get) => ({
  tasks: [],
  lastFetchedAt: null,
  loading: false,
  initialized: false,
  connectionStatus: 'online' as ConnectionStatus,
  consecutiveFailures: 0,
  lastError: null,

  fetchAll: async () => {
    // If already initialized, use fetchUpdates
    if (get().initialized) {
      logger.debug(
        '[taskCacheStore] fetchAll: Already initialized, calling fetchUpdates instead',
      );
      return get().fetchUpdates();
    }

    logger.info('[taskCacheStore] fetchAll: Starting full fetch');
    set({ loading: true });
    try {
      const res = await fetchWithRetry(`${API_BASE_URL}/tasks`);
      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        logger.error('GET /tasks failed:', res.status, res.statusText, text);
        throw new Error('取得に失敗しました');
      }
      const data: Task[] = await res.json();
      logger.info(`[taskCacheStore] fetchAll: Received ${data.length} tasks`);
      set({
        tasks: data,
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
        loading: false,
        connectionStatus: 'online',
        consecutiveFailures: 0,
        lastError: null,
      });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.error('[taskCacheStore] fetchAll error:', e);
      // Set initialized to true even on error and display empty list
      set({
        initialized: true,
        loading: false,
        connectionStatus: 'offline',
        consecutiveFailures: get().consecutiveFailures + 1,
        lastError: errorMessage,
      });
    }
  },

  fetchUpdates: async (silent = false) => {
    const { lastFetchedAt, tasks } = get();
    if (!lastFetchedAt) {
      // No previous fetch — do full fetch instead
      logger.debug(
        '[taskCacheStore] fetchUpdates: No lastFetchedAt, calling fetchAll',
      );
      return get().fetchAll();
    }

    const wasOffline = get().connectionStatus !== 'online';
    if (wasOffline) {
      logger.debug('[taskCacheStore] fetchUpdates: Attempting reconnection');
      set({ connectionStatus: 'reconnecting' });
    } else {
      logger.debug(
        `[taskCacheStore] fetchUpdates: Starting incremental fetch (silent: ${silent})`,
      );
    }

    // Only show loading indicator if not silent
    if (!silent) {
      set({ loading: true });
    }
    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/tasks?since=${encodeURIComponent(lastFetchedAt)}`,
      );
      if (!res.ok) {
        const { consecutiveFailures } = get();
        const newFailures = consecutiveFailures + 1;
        if (newFailures <= MAX_LOGGED_FAILURES) {
          logger.error('[taskCacheStore] fetchUpdates failed:', res.status);
        }
        set({
          connectionStatus: 'offline',
          consecutiveFailures: newFailures,
          lastError: `HTTP ${res.status}`,
        });
        if (!silent) {
          set({ loading: false });
        }
        return;
      }

      // Success — handle recovery if we were offline
      if (wasOffline) {
        logger.info('[taskCacheStore] fetchUpdates: Connection recovered');
      }
      set({
        connectionStatus: 'online',
        consecutiveFailures: 0,
        lastError: null,
      });

      const data = await res.json();

      // Incremental response: { tasks, totalCount, activeIds, since, incremental }
      if (data.incremental) {
        const updatedTasks: Task[] = data.tasks;
        const serverTotalCount: number = data.totalCount;
        const activeIds: number[] = data.activeIds || [];

        // Merge updates into existing cache
        const taskMap = new Map(tasks.map((t) => [t.id, t]));

        // Apply updated tasks
        for (const updated of updatedTasks) {
          taskMap.set(updated.id, updated);
        }

        // If activeIds provided, detect deleted tasks
        if (activeIds.length > 0) {
          const activeIdSet = new Set(activeIds);
          const beforeCount = taskMap.size;

          // Delete tasks that exist locally but not on server
          for (const [id] of taskMap) {
            if (!activeIdSet.has(id)) {
              taskMap.delete(id);
            }
          }

          const deletedCount = beforeCount - taskMap.size;
          if (deletedCount > 0) {
            logger.info(
              `[taskCacheStore] fetchUpdates: Removed ${deletedCount} deleted tasks`,
            );
          }
        } else if (taskMap.size > serverTotalCount) {
          // If activeIds not available, use traditional method (refetch all)
          logger.info(
            `[taskCacheStore] fetchUpdates: Local count (${taskMap.size}) > server count (${serverTotalCount}), refetching all`,
          );
          if (!silent) {
            set({ loading: false });
          }
          return get().fetchAll();
        }

        const merged = Array.from(taskMap.values());
        logger.debug(
          `[taskCacheStore] fetchUpdates: Merged ${updatedTasks.length} updates, total: ${merged.length}`,
        );
        set({
          tasks: merged,
          lastFetchedAt: new Date().toISOString(),
        });
      } else {
        // Fallback: server returned plain array (shouldn't happen with since param, but handle gracefully)
        logger.debug(
          '[taskCacheStore] fetchUpdates: Received non-incremental response',
        );
        set({
          tasks: data,
          lastFetchedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      const { consecutiveFailures } = get();
      const newFailures = consecutiveFailures + 1;
      const errorMessage = e instanceof Error ? e.message : String(e);

      // Suppress repeated error logs after MAX_LOGGED_FAILURES
      if (newFailures <= MAX_LOGGED_FAILURES) {
        logger.error('[taskCacheStore] fetchUpdates error:', e);
      } else if (newFailures === MAX_LOGGED_FAILURES + 1) {
        logger.warn(
          '[taskCacheStore] fetchUpdates: Suppressing further error logs until recovery',
        );
      }

      set({
        connectionStatus: 'offline',
        consecutiveFailures: newFailures,
        lastError: errorMessage,
      });
      // Tasks are preserved in cache — no data loss on failure
    } finally {
      if (!silent) {
        logger.debug('[taskCacheStore] fetchUpdates: Setting loading to false');
        set({ loading: false });
      }
    }
  },

  updateTaskLocally: (id, patch) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  },

  removeTaskLocally: (id) => {
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    }));
  },

  addTaskLocally: (task) => {
    set((state) => ({
      tasks: [task, ...state.tasks],
    }));
  },

  setTasks: (tasks) => {
    set({ tasks });
  },
}));
