import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UIMode = "task" | "ai" | "note";

interface UIModeState {
  /** 現在のUIモード */
  currentMode: UIMode;
  /** 特定のモードに設定する */
  setMode: (mode: UIMode) => void;
}

/**
 * UIのモード（タスク/AI/ノート）を管理するストア
 */
export const useUIModeStore = create<UIModeState>()(
  persist(
    (set) => ({
      currentMode: "task",

      setMode: (mode) => set({ currentMode: mode }),
    }),
    {
      name: "ui-mode-storage",
    }
  )
);