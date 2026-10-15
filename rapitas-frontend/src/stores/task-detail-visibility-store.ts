import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Which edge the task detail slide panel docks to. Default 'right'. */
export type TaskDetailDockSide = 'left' | 'right';

/**
 * How the task detail panel occupies the viewport.
 * 'overlay' floats above the page with a click-to-close backdrop;
 * 'split' tiles beside the page (AppContent reserves the width) so the
 * list stays interactive while the detail is open.
 */
export type TaskDetailDisplayMode = 'overlay' | 'split';

// NOTE: Must match the panel's split-mode width class (md:w-[50vw] in
// TaskSlidePanel.tsx) — AppContent reserves exactly this much page padding.
export const TASK_DETAIL_SPLIT_WIDTH_VW = 50;

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
  /** Overlay (float above the page) or split (tile beside it). Persisted. */
  displayMode: TaskDetailDisplayMode;
  setDisplayMode: (mode: TaskDetailDisplayMode) => void;
  toggleDisplayMode: () => void;
}

/**
 * Store managing task detail panel visibility, dock side, and display mode.
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
      displayMode: 'overlay',
      setDisplayMode: (mode) => set({ displayMode: mode }),
      toggleDisplayMode: () =>
        set({ displayMode: get().displayMode === 'overlay' ? 'split' : 'overlay' }),
    }),
    {
      name: 'rapitas-task-detail-panel',
      // Visibility is session-scoped (re-derived from the URL/panel state on
      // load); the dock-side and display-mode preferences persist across reloads.
      partialize: (state) => ({ dockSide: state.dockSide, displayMode: state.displayMode }),
    },
  ),
);
