import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UIMode = 'task' | 'ai' | 'note';

interface UIModeState {
  /** Current UI mode */
  currentMode: UIMode;
  /** Set to specific mode */
  setMode: (mode: UIMode) => void;
}

/**
 * Store managing UI mode (task/AI/note)
 */
export const useUIModeStore = create<UIModeState>()(
  persist(
    (set) => ({
      currentMode: 'task',

      setMode: (mode) => set({ currentMode: mode }),
    }),
    {
      name: 'ui-mode-storage',
    },
  ),
);
