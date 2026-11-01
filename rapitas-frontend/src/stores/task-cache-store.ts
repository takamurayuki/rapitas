import { create } from 'zustand';
import type { Task } from '@/types';
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

/**
 * Upper bound on in-memory task count. When exceeded after a merge, the oldest
 * completed tasks are evicted so the store does not grow unbounded during
 * months-long auto-run sessions.
 */
const MAX_CACHE_SIZE = 800;

/**
 * Evict the oldest completed tasks when the merged list exceeds MAX_CACHE_SIZE.
 * Non-completed tasks are always retained; completed tasks are sorted by id
 * (descending) and the tail is dropped.
 *
 * @param merged - Full merged task array / マージ済みタスク配列
 * @returns Possibly pruned array / 必要に応じてトリミングされた配列
 */
function applyMaxCacheSize(merged: Task[]): Task[] {
  if (merged.length <= MAX_CACHE_SIZE) return merged;
  const active = merged.filter((t) => t.status !== 'done');
  const done = merged
    .filter((t) => t.status === 'done')
    .sort((a, b) => b.id - a.id)
    .slice(0, Math.max(0, MAX_CACHE_SIZE - active.length));
  logger.info(
    `[taskCacheStore] cache cap: kept ${active.length} active + ${done.length} done ` +
      `(evicted ${merged.length - active.length - done.length})`,
  );
  return [...active, ...done];
}

export const useTaskCacheStore = create<TaskCacheState>()((set, get) => {
  // The one real implementation of a full GET /tasks refetch — never
  // delegates anywhere else. fetchAll() and fetchUpdates()'s own resync path
  // both funnel through this directly instead of calling each other, so a
  // full refetch can never bounce back into an incremental fetch. It used to:
  // fetchUpdates saw its local task count exceed the server's total and
  // called fetchAll(), which (since `lastFetchedAt` was already set) just
  // called fetchUpdates() right back — the *same* `/tasks?since=...` request,
  // which a still-mismatched server answers identically, so the pair looped
  // forever instead of ever reaching a real `/tasks` fetch that could resolve
  // the mismatch. Surfaced as a task list stuck on its loading skeleton.
  const performFullFetch = async (): Promise<void> => {
    // De-duplicate concurrent full fetches. GET /tasks returns the entire task
    // list — measured 2026-10-06: 650 tasks, 3.18 MB, 1.76 s on an idle
    // backend — and nothing stopped several callers (mount, focus, an SSE
    // event, a route change) each starting their own. `loading` was set but
    // never read as a guard.
    //
    // Overlapping copies turned a slow endpoint into an outage: 16 concurrent
    // connections to :3001, the WebView2 network service holding ~700 MB and
    // 36% of a core, its browser process 96.5%, while each response cost the
    // backend another 1.76 s of event loop. That pushed Prisma transactions
    // past their 5 s budget (30 s observed), so queue dequeues failed and
    // retried every tick and heartbeat/output writes failed with them — the
    // frontend then could not reach the backend at all. fetchWithRetry's
    // 10 s timeout closes the loop: once the backend is slow enough, every
    // attempt aborts and retries, adding load that makes it slower.
    //
    // Pinned to globalThis, not module scope: Next dev HMR re-evaluates this
    // module, which would reset a module-scope holder and let a second fetch
    // start alongside the first — the same hot-reload hazard that made
    // pomodoro-store.ts and pomodoro-broadcast.ts pin their singletons after
    // the 2026-09-03 WebView2 CPU incident.
    const g = globalThis as unknown as { __rapitasTaskFullFetch?: Promise<void> | null };
    if (g.__rapitasTaskFullFetch) {
      logger.debug('[taskCacheStore] fetchAll: full fetch already in flight — joining it');
      return g.__rapitasTaskFullFetch;
    }
    const run = runFullFetch().finally(() => {
      g.__rapitasTaskFullFetch = null;
    });
    g.__rapitasTaskFullFetch = run;
    return run;
  };

  const runFullFetch = async () => {
    logger.info('[taskCacheStore] fetchAll: Starting full fetch');
    set({ loading: true });
    // NOTE(#1332): Stamped BEFORE the request, not when the reply arrives.
    // See `nextSince` in fetchUpdates for the full reasoning: a boundary taken
    // at receive time silently skips every row written while the request was
    // in flight. Stamping early can re-deliver one, which a merge by id
    // absorbs; skipping one loses it for good.
    const requestedAt = new Date().toISOString();
    try {
      const res = await fetchWithRetry(`${API_BASE_URL}/tasks`);
      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        logger.error('GET /tasks failed:', res.status, res.statusText, text);
        // NOTE: `lastError` is never rendered in the UI today (verified: no
        // component reads it) — a stable code (matching `common.fetchFailed`)
        // is stored instead of a hardcoded Japanese string so a future
        // display site can localize it via `t('common.fetchFailed')`.
        throw new Error('fetchFailed');
      }
      const raw: Task[] = await res.json();
      const data = applyMaxCacheSize(raw);
      logger.info(
        `[taskCacheStore] fetchAll: Received ${raw.length} tasks (cached: ${data.length})`,
      );
      set({
        tasks: data,
        lastFetchedAt: requestedAt,
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
  };

  return {
    tasks: [],
    lastFetchedAt: null,
    loading: false,
    initialized: false,
    connectionStatus: 'online' as ConnectionStatus,
    consecutiveFailures: 0,
    lastError: null,

    fetchAll: async () => {
      // Delegate to the incremental path only when we have a baseline to diff
      // against — fetchUpdates's own resync path calls performFullFetch
      // directly (see above), so this can't ping-pong back here.
      if (get().initialized && get().lastFetchedAt) {
        logger.debug(
          '[taskCacheStore] fetchAll: Already initialized, calling fetchUpdates instead',
        );
        return get().fetchUpdates();
      }
      return performFullFetch();
    },

    fetchUpdates: async (silent = false) => {
      const { lastFetchedAt, tasks } = get();
      if (!lastFetchedAt) {
        // No previous fetch — do full fetch instead
        logger.debug('[taskCacheStore] fetchUpdates: No lastFetchedAt, calling fetchAll');
        return performFullFetch();
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
      // NOTE(#1332): The next boundary is decided BEFORE the request goes out,
      // and the server's own `nextSince` (stamped when it queried) wins when
      // it is present. This used to be `new Date().toISOString()` at the point
      // the reply was handled, which meant the next fetch asked for changes
      // after a moment that had already passed: anything updated between send
      // and receive was never requested again. Erring early re-delivers a row
      // at worst — `taskMap.set(id, …)` is idempotent — while erring late
      // drops it permanently.
      const requestedAt = new Date().toISOString();
      /** The server's boundary if it sent one, else the pre-request stamp. */
      const nextBoundary = (data: { nextSince?: unknown }): string =>
        typeof data.nextSince === 'string' ? data.nextSince : requestedAt;

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
          let deletedCount = 0;
          if (activeIds.length > 0) {
            const activeIdSet = new Set(activeIds);
            const beforeCount = taskMap.size;

            // Delete tasks that exist locally but not on server
            for (const [id] of taskMap) {
              if (!activeIdSet.has(id)) {
                taskMap.delete(id);
              }
            }

            deletedCount = beforeCount - taskMap.size;
            if (deletedCount > 0) {
              logger.info(`[taskCacheStore] fetchUpdates: Removed ${deletedCount} deleted tasks`);
            }
          } else if (taskMap.size > serverTotalCount) {
            // If activeIds not available, use traditional method (refetch all)
            logger.info(
              `[taskCacheStore] fetchUpdates: Local count (${taskMap.size}) > server count (${serverTotalCount}), refetching all`,
            );
            if (!silent) {
              set({ loading: false });
            }
            return performFullFetch();
          }

          // NOTE: No updates and no deletions this cycle — skip rewriting `tasks`.
          // A fresh Array.from() would change the array reference and force
          // useFilteredTasks/useTaskSorting to recompute, flickering the list on
          // every poll. Advance lastFetchedAt only so the next fetch stays incremental.
          if (updatedTasks.length === 0 && deletedCount === 0) {
            set({ lastFetchedAt: nextBoundary(data) });
            if (!silent) {
              set({ loading: false });
            }
            return;
          }

          const merged = applyMaxCacheSize(Array.from(taskMap.values()));
          logger.debug(
            `[taskCacheStore] fetchUpdates: Merged ${updatedTasks.length} updates, total: ${merged.length}`,
          );
          set({
            tasks: merged,
            lastFetchedAt: nextBoundary(data),
          });
        } else {
          // Fallback: server returned plain array (shouldn't happen with since param, but handle gracefully)
          logger.debug('[taskCacheStore] fetchUpdates: Received non-incremental response');
          set({
            tasks: data,
            // A plain-array reply carries no boundary of its own.
            lastFetchedAt: requestedAt,
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
  };
});
