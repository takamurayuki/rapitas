/**
 * goal-reflection-store
 *
 * Whether the weekly reflection modal is open. The weekly nudge notification
 * opens it from the notification bell; nothing else addresses it.
 */
import { create } from 'zustand';

interface GoalReflectionModalState {
  /** Whether the modal is shown. */
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useGoalReflectionModalStore = create<GoalReflectionModalState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));

/** Opens the reflection modal from anywhere (event handlers, non-React code). */
export function openGoalReflection(): void {
  useGoalReflectionModalStore.getState().open();
}
