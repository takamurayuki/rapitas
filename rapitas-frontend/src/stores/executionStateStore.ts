import { create } from 'zustand';

interface ExecutingTask {
  taskId: number;
  sessionId?: number;
  status: 'running' | 'waiting_for_input' | 'completed' | 'failed';
}

interface ExecutionStateStore {
  /** 現在実行中のタスク一覧 */
  executingTasks: Map<number, ExecutingTask>;
  /** 実行中のタスクを追加/更新 */
  setExecutingTask: (task: ExecutingTask) => void;
  /** 実行が完了したタスクを除去 */
  removeExecutingTask: (taskId: number) => void;
  /** 全てクリア */
  clearAll: () => void;
  /** 指定タスクが実行中かどうか */
  isTaskExecuting: (taskId: number) => boolean;
  /** 指定タスクの実行状態を取得 */
  getExecutingTaskStatus: (taskId: number) => 'running' | 'waiting_for_input' | null;
}

export const useExecutionStateStore = create<ExecutionStateStore>()(
  (set, get) => ({
    executingTasks: new Map(),
    setExecutingTask: (task) =>
      set((state) => {
        const existing = state.executingTasks.get(task.taskId);
        if (existing && existing.status === task.status && existing.sessionId === task.sessionId) {
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
