import { create } from 'zustand';

interface ExecutingTask {
  taskId: number;
  sessionId?: number;
  status: 'running' | 'waiting_for_input' | 'completed' | 'failed';
}

interface ExecutionStateStore {
  /** List of currently executing tasks */
  executingTasks: Map<number, ExecutingTask>;
  /** Task IDs that are currently loading execution status (show skeleton) */
  loadingTaskIds: Set<number>;
  /** Add/update executing task */
  setExecutingTask: (task: ExecutingTask) => void;
  /** Remove completed tasks */
  removeExecutingTask: (taskId: number) => void;
  /** Clear all */
  clearAll: () => void;
  /** Whether specified task is executing */
  isTaskExecuting: (taskId: number) => boolean;
  /** Get execution status of specified task */
  getExecutingTaskStatus: (
    taskId: number,
  ) => 'running' | 'waiting_for_input' | null;
  /** Mark a task as loading execution status (skeleton should be shown) */
  setTaskLoading: (taskId: number) => void;
  /** Mark a task as done loading execution status */
  setTaskLoaded: (taskId: number) => void;
  /** Whether a task is currently loading execution status */
  isTaskLoading: (taskId: number) => boolean;
}

export const useExecutionStateStore = create<ExecutionStateStore>()(
  (set, get) => ({
    executingTasks: new Map(),
    loadingTaskIds: new Set(),
    setTaskLoading: (taskId) =>
      set((state) => {
        if (state.loadingTaskIds.has(taskId)) return state;
        const newSet = new Set(state.loadingTaskIds);
        newSet.add(taskId);
        return { loadingTaskIds: newSet };
      }),
    setTaskLoaded: (taskId) =>
      set((state) => {
        if (!state.loadingTaskIds.has(taskId)) return state;
        const newSet = new Set(state.loadingTaskIds);
        newSet.delete(taskId);
        return { loadingTaskIds: newSet };
      }),
    isTaskLoading: (taskId) => get().loadingTaskIds.has(taskId),
    setExecutingTask: (task) =>
      set((state) => {
        const existing = state.executingTasks.get(task.taskId);
        if (
          existing &&
          existing.status === task.status &&
          existing.sessionId === task.sessionId
        ) {
          return state;
        }
        const newMap = new Map(state.executingTasks);
        newMap.set(task.taskId, task);
        return { executingTasks: newMap };
      }),
    removeExecutingTask: (taskId) =>
      set((state) => {
        if (!state.executingTasks.has(taskId)) return state;
        const newMap = new Map(state.executingTasks);
        newMap.delete(taskId);
        return { executingTasks: newMap };
      }),
    clearAll: () => set({ executingTasks: new Map() }),
    isTaskExecuting: (taskId) => {
      const task = get().executingTasks.get(taskId);
      return task?.status === 'running' || task?.status === 'waiting_for_input';
    },
    getExecutingTaskStatus: (taskId) => {
      const task = get().executingTasks.get(taskId);
      if (!task) return null;
      if (task.status === 'running' || task.status === 'waiting_for_input') {
        return task.status;
      }
      return null;
    },
  }),
);
