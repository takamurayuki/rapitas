import { useState, useEffect, useCallback } from "react";
import {
  isTauri,
  openExternalUrlInSplitView,
  isSplitViewActive,
} from "@/utils/tauri";

interface UseSplitViewReturn {
  /** 分割表示が現在アクティブかどうか */
  isActive: boolean;
  /** 外部URLを分割表示で開く */
  openSplitView: (url: string) => Promise<void>;
  /** 分割表示状態を手動で更新（内部使用） */
  refreshStatus: () => void;
}

/**
 * 分割表示機能を管理するカスタムフック
 * Tauri環境では実際の分割表示機能を提供し、Web環境では通常の新しいタブで開く
 */
export function useSplitView(): UseSplitViewReturn {
  const [isActive, setIsActive] = useState(false);

  // 分割表示状態を確認
  const checkSplitViewStatus = useCallback(() => {
    if (isTauri()) {
      setIsActive(isSplitViewActive());
    } else {
      setIsActive(false);
    }
  }, []);

  // コンポーネントマウント時と定期的に状態を確認
  useEffect(() => {
    // 初回チェックを非同期で実行
    const timer = setTimeout(() => checkSplitViewStatus(), 0);

    // 定期的に状態を確認（ユーザーが手動でウィンドウサイズを変更した場合などを検知）
    const interval = setInterval(checkSplitViewStatus, 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [checkSplitViewStatus]);

  // 外部URLを分割表示で開く
  const openSplitView = useCallback(
    async (url: string) => {
      try {
        await openExternalUrlInSplitView(url);
        // 少し遅延してから状態を更新（ウィンドウ操作が完了するまで待機）
        setTimeout(checkSplitViewStatus, 500);
      } catch (error) {
        console.error("Failed to open split view:", error);
      }
    },
    [checkSplitViewStatus],
  );

  return {
    isActive,
    openSplitView,
    refreshStatus: checkSplitViewStatus,
  };
}
