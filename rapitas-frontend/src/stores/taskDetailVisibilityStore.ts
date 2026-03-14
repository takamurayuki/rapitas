import { create } from 'zustand';

interface TaskDetailVisibilityState {
  /** Whether task detail panel is displayed */
  isTaskDetailVisible: boolean;
  /** Show task detail panel */
  showTaskDetail: () => void;
  /** Hide task detail panel */
  hideTaskDetail: () => void;
}

/**
 * Store managing task detail panel visibility
 */
export const useTaskDetailVisibilityStore = create<TaskDetailVisibilityState>()(
  (set) => ({
    isTaskDetailVisible: false,
    showTaskDetail: () => set({ isTaskDetailVisible: true }),
    hideTaskDetail: () => set({ isTaskDetailVisible: false }),
  }),
);
