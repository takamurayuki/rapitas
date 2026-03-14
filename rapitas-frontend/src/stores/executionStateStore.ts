import { create } from 'zustand';

interface ExecutingTask {
  taskId: number;
  sessionId?: number;
  status: 'running' | 'waiting_for_input' | 'completed' | 'failed';
}

interface ExecutionStateStore {
  /** List of currently executing tasks */
  executingTasks: Map<number, ExecutingTask>;
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
}

export const useExecutionStateStore = create<ExecutionStateStore>()(
  (set, get) => ({
    executingTasks: new Map(),
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
