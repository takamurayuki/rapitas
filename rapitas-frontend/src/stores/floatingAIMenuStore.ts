import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FloatingAIMenuPosition {
  /** X座標（右からの距離） */
  right: number;
  /** Y座標（下からの距離） */
  bottom: number;
}

interface FloatingAIMenuState {
  /** AIアシスタントが有効かどうか */
  isEnabled: boolean;
  /** フローティングボタンの位置 */
  position: FloatingAIMenuPosition;
  /** AIアシスタントの有効/無効を切り替え */
  toggle: () => void;
  /** AIアシスタントを有効にする */
  enable: () => void;
  /** AIアシスタントを無効にする */
  disable: () => void;
  /** フローティングボタンの位置を更新 */
  updatePosition: (position: FloatingAIMenuPosition) => void;
  /** フローティングボタンの位置をリセット */
  resetPosition: () => void;
}

const DEFAULT_POSITION: FloatingAIMenuPosition = {
  right: 24, // 1.5rem = 24px (元の位置と同じ)
  bottom: 24, // 1.5rem = 24px
};

/**
 * フローティングAIアシスタントの表示状態と位置を管理するストア
 * Ctrl + Y で切り替え可能
 * 状態はlocalStorageに永続化される
 */
export const useFloatingAIMenuStore = create<FloatingAIMenuState>()(
  persist(
    (set) => ({
      isEnabled: true,
      position: DEFAULT_POSITION,
      toggle: () => set((state) => ({ isEnabled: !state.isEnabled })),
      enable: () => set({ isEnabled: true }),
      disable: () => set({ isEnabled: false }),
      updatePosition: (position) => set({ position }),
      resetPosition: () => set({ position: DEFAULT_POSITION }),
    }),
    {
      name: "floating-ai-menu-storage",
    }
  )
);
