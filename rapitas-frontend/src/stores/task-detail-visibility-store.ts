import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Which edge the task detail slide panel docks to. Default 'right'. */
export type TaskDetailDockSide = 'left' | 'right';

interface TaskDetailVisibilityState {
  /** Whether task detail panel is displayed */
  isTaskDetailVisible: boolean;
  /** Show task detail panel */
  showTaskDetail: () => void;
  /** Hide task detail panel */
  hideTaskDetail: () => void;
  /** Which edge the panel slides in from. Persisted (unlike visibility, which is session-scoped). */
  dockSide: TaskDetailDockSide;
  setDockSide: (side: TaskDetailDockSide) => void;
  toggleDockSide: () => void;
}

/**
 * Store managing task detail panel visibility and its dock side.
 */
export const useTaskDetailVisibilityStore = create<TaskDetailVisibilityState>()(
  persist(
    (set, get) => ({
      isTaskDetailVisible: false,
      showTaskDetail: () => set({ isTaskDetailVisible: true }),
      hideTaskDetail: () => set({ isTaskDetailVisible: false }),
      dockSide: 'right',
      setDockSide: (side) => set({ dockSide: side }),
      toggleDockSide: () => set({ dockSide: get().dockSide === 'right' ? 'left' : 'right' }),
    }),
    {
      name: 'rapitas-task-detail-panel',
      // Visibility is session-scoped (re-derived from the URL/panel state on
      // load); only the dock-side preference persists across reloads.
      partialize: (state) => ({ dockSide: state.dockSide }),
    },
  ),
);
