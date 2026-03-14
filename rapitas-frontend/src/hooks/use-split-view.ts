import { useState, useEffect, useCallback } from 'react';
import {
  isTauri,
  openExternalUrlInSplitView,
  isSplitViewActive,
} from '@/utils/tauri';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useSplitView');

interface UseSplitViewReturn {
  /** Whether split view is currently active */
  isActive: boolean;
  /** Open external URL in split view */
  openSplitView: (url: string) => Promise<void>;
  /** Manually update split view status (internal use) */
  refreshStatus: () => void;
}

/**
 * Custom hook for managing split view functionality
 * Provides actual split view in Tauri environment, opens in new tab in web environment
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
        logger.error('Failed to open split view:', error);
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
