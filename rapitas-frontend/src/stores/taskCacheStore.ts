import { create } from "zustand";
import type { Task, Status } from "@/types";
import { API_BASE_URL, fetchWithRetry } from "@/utils/api";

type TaskCacheState = {
  tasks: Task[];
  lastFetchedAt: string | null;
  loading: boolean;
  initialized: boolean;

  /** Initial full fetch — call once on mount */
  fetchAll: () => Promise<void>;

  /** Incremental fetch — only updated tasks since last fetch + detect deletions via count */
  fetchUpdates: () => Promise<void>;

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
    set({ loading: true });
    try {
      const res = await fetchWithRetry(`${API_BASE_URL}/tasks`);
      if (!res.ok) {
        const text = await res.text().catch(() => "<no body>");
        console.error("GET /tasks failed:", res.status, res.statusText, text);
        throw new Error("取得に失敗しました");
      }
      const data: Task[] = await res.json();
      set({
        tasks: data,
        lastFetchedAt: new Date().toISOString(),
        initialized: true,
      });
    } catch (e) {
      console.error("[taskCacheStore] fetchAll error:", e);
    } finally {
      set({ loading: false });
    }
  },

  fetchUpdates: async () => {
    const { lastFetchedAt, tasks } = get();
    if (!lastFetchedAt) {
      // No previous fetch — do full fetch instead
      return get().fetchAll();
    }

    try {
      const res = await fetchWithRetry(
        `${API_BASE_URL}/tasks?since=${encodeURIComponent(lastFetchedAt)}`,
      );
      if (!res.ok) {
        console.error("[taskCacheStore] fetchUpdates failed:", res.status);
        return;
      }

      const data = await res.json();

      // Incremental response: { tasks, totalCount, since, incremental }
      if (data.incremental) {
        const updatedTasks: Task[] = data.tasks;
        const serverTotalCount: number = data.totalCount;

        // Merge updates into existing cache
        const taskMap = new Map(tasks.map((t) => [t.id, t]));
        for (const updated of updatedTasks) {
          taskMap.set(updated.id, updated);
        }

        let merged = Array.from(taskMap.values());

        // If our local count exceeds server count, some tasks were deleted elsewhere.
        // Remove stale entries by refetching fully.
        if (merged.length > serverTotalCount) {
          return get().fetchAll();
        }

        set({
          tasks: merged,
          lastFetchedAt: new Date().toISOString(),
        });
      } else {
        // Fallback: server returned plain array (shouldn't happen with since param, but handle gracefully)
        set({
          tasks: data,
          lastFetchedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error("[taskCacheStore] fetchUpdates error:", e);
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
