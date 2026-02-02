import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FloatingAIMenuState {
  /** AIアシスタントが有効かどうか */
  isEnabled: boolean;
  /** AIアシスタントの有効/無効を切り替え */
  toggle: () => void;
  /** AIアシスタントを有効にする */
  enable: () => void;
  /** AIアシスタントを無効にする */
  disable: () => void;
}

/**
 * フローティングAIアシスタントの表示状態を管理するストア
 * Ctrl + Y で切り替え可能
 * 状態はlocalStorageに永続化される
 */
export const useFloatingAIMenuStore = create<FloatingAIMenuState>()(
  persist(
    (set) => ({
      isEnabled: true,
      toggle: () => set((state) => ({ isEnabled: !state.isEnabled })),
      enable: () => set({ isEnabled: true }),
      disable: () => set({ isEnabled: false }),
    }),
    {
      name: "floating-ai-menu-storage",
    }
  )
);
