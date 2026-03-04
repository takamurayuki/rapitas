import { create } from 'zustand';
import type { Task, Status } from '@/types';
import { API_BASE_URL, fetchWithRetry } from '@/utils/api';

type TaskCacheState = {
  tasks: Task[];
  lastFetchedAt: string | null;
  loading: boolean;
  initialized: boolean;

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

export const useTaskCacheStore = create<TaskCacheState>()((set, get) => ({
  tasks: [],
  lastFetchedAt: null,
  loading: false,
  initialized: false,

  fetchAll: async () => {
    // 既に初期化済みなら、fetchUpdatesを使用する
    if (get().initialized) {
      console.log('[taskCacheStore] fetchAll: Already initialized, calling fetchUpdates instead');
      return get().fetchUpdates();
    }

    console.log('[taskCacheStore] fetchAll: Starting full fetch');
    set({ loading: true });
    try {
      const res = await fetchWithRetry(`${API_BASE_URL}/tasks`);
      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        console.error('GET /tasks failed:', res.status, res.statusText, text);
        throw new Error('取得に失敗しました');
      }
      const data: Task[] = await res.json();
      console.log(`[taskCacheStore] fetchAll: Received ${data.length} tasks`);
      set({
        tasks: data,
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
        loading: false, // 成功時は即座にloadingをfalseに
      });
    } catch (e) {
      console.error('[taskCacheStore] fetchAll error:', e);
      // エラー時でもinitializedをtrueにして、空のリストを表示
      set({ initialized: true, loading: false });
    }
  },

  fetchUpdates: async (silent = false) => {
    const { lastFetchedAt, tasks } = get();
    if (!lastFetchedAt) {
      // No previous fetch — do full fetch instead
      console.log('[taskCacheStore] fetchUpdates: No lastFetchedAt, calling fetchAll');
      return get().fetchAll();
    }

    console.log(`[taskCacheStore] fetchUpdates: Starting incremental fetch (silent: ${silent})`);
    // Only show loading indicator if not silent
    if (!silent) {
      set({ loading: true });
    }
    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/tasks?since=${encodeURIComponent(lastFetchedAt)}`,
      );
      if (!res.ok) {
        console.error('[taskCacheStore] fetchUpdates failed:', res.status);
        if (!silent) {
          set({ loading: false });
        }
        return;
      }

      const data = await res.json();

      // Incremental response: { tasks, totalCount, activeIds, since, incremental }
      if (data.incremental) {
        const updatedTasks: Task[] = data.tasks;
        const serverTotalCount: number = data.totalCount;
        const activeIds: number[] = data.activeIds || [];

        // Merge updates into existing cache
        const taskMap = new Map(tasks.map((t) => [t.id, t]));

        // 更新されたタスクを適用
        for (const updated of updatedTasks) {
          taskMap.set(updated.id, updated);
        }

        // activeIdsが提供されている場合、削除されたタスクを検出
        if (activeIds.length > 0) {
          const activeIdSet = new Set(activeIds);
          const beforeCount = taskMap.size;

          // ローカルに存在するが、サーバーには存在しないタスクを削除
          for (const [id] of taskMap) {
            if (!activeIdSet.has(id)) {
              taskMap.delete(id);
            }
          }

          const deletedCount = beforeCount - taskMap.size;
          if (deletedCount > 0) {
            console.log(`[taskCacheStore] fetchUpdates: Removed ${deletedCount} deleted tasks`);
          }
        } else if (taskMap.size > serverTotalCount) {
          // activeIdsがない場合は従来の方法（全件再取得）
          console.log(`[taskCacheStore] fetchUpdates: Local count (${taskMap.size}) > server count (${serverTotalCount}), refetching all`);
          if (!silent) {
            set({ loading: false });
          }
          return get().fetchAll();
        }

        const merged = Array.from(taskMap.values());
        console.log(`[taskCacheStore] fetchUpdates: Merged ${updatedTasks.length} updates, total: ${merged.length}`);
        set({
          tasks: merged,
          lastFetchedAt: new Date().toISOString(),
        });
      } else {
        // Fallback: server returned plain array (shouldn't happen with since param, but handle gracefully)
        console.log('[taskCacheStore] fetchUpdates: Received non-incremental response');
        set({
          tasks: data,
          lastFetchedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error('[taskCacheStore] fetchUpdates error:', e);
    } finally {
      if (!silent) {
        console.log('[taskCacheStore] fetchUpdates: Setting loading to false');
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
