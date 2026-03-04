import { create } from 'zustand';

interface TaskDetailVisibilityState {
  /** タスク詳細パネルが表示されているかどうか */
  isTaskDetailVisible: boolean;
  /** タスク詳細パネルを表示する */
  showTaskDetail: () => void;
  /** タスク詳細パネルを非表示にする */
  hideTaskDetail: () => void;
}

/**
 * タスク詳細パネルの表示状態を管理するストア
 */
export const useTaskDetailVisibilityStore = create<TaskDetailVisibilityState>()(
  (set) => ({
    isTaskDetailVisible: false,
    showTaskDetail: () => set({ isTaskDetailVisible: true }),
    hideTaskDetail: () => set({ isTaskDetailVisible: false }),
  }),
);
