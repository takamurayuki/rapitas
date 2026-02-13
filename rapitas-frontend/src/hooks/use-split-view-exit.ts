/**
 * 分割表示の終了を管理するフック
 */
import { useEffect } from "react";
import { isTauri, isSplitViewActive } from "@/utils/tauri";

export function useSplitViewExit() {
  useEffect(() => {
    if (!isTauri()) return;

    // Escキーで分割表示を終了
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isSplitViewActive()) {
        // handleExitSplitView is removed, so no action here
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return {
    isSplitViewActive: isSplitViewActive(),
  };
}
