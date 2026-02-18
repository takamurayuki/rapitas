import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type AppMode = 'development' | 'learning' | 'all';

type AppModeState = {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
};

export const useAppModeStore = create<AppModeState>()(
  persist(
    (set) => ({
      mode: 'all',
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'app-mode-storage',
    },
  ),
);
