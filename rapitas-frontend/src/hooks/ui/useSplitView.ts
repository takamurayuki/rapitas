import { useState, useEffect, useCallback } from 'react';
import { isTauri, openExternalUrlInSplitView, isSplitViewActive } from '@/utils/tauri';
import { createLogger } from '@/lib/logger';
import { getAppHidden } from '@/hooks/common/app-visibility-store';

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

  // Check split view state
  const checkSplitViewStatus = useCallback(() => {
    // Skip while hidden — window geometry can't change when the window isn't
    // visible. getAppHidden() covers minimize, which occlusion-disabled
    // WebView2 doesn't report via document.hidden.
    if ((typeof document !== 'undefined' && document.hidden) || getAppHidden()) return;
    if (isTauri()) {
      setIsActive(isSplitViewActive());
    } else {
      setIsActive(false);
    }
  }, []);

  // Check state on mount and on events that can actually change it (manual
  // window resize, or the window regaining visibility after being hidden).
  useEffect(() => {
    // Run initial check asynchronously
    const timer = setTimeout(() => checkSplitViewStatus(), 0);

    window.addEventListener('resize', checkSplitViewStatus);
    document.addEventListener('visibilitychange', checkSplitViewStatus);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkSplitViewStatus);
      document.removeEventListener('visibilitychange', checkSplitViewStatus);
    };
  }, [checkSplitViewStatus]);

  // Open external URL in split view
  const openSplitView = useCallback(
    async (url: string) => {
      try {
        await openExternalUrlInSplitView(url);
        // NOTE: Delay state update to wait for window operation completion
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
