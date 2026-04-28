import { useState, useEffect, useCallback } from 'react';
import { isTauri, openExternalUrlInSplitView, isSplitViewActive } from '@/utils/tauri';
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

  // Check split view state
  const checkSplitViewStatus = useCallback(() => {
    if (isTauri()) {
      setIsActive(isSplitViewActive());
    } else {
      setIsActive(false);
    }
  }, []);

  // Check state on mount and periodically
  useEffect(() => {
    // Run initial check asynchronously
    const timer = setTimeout(() => checkSplitViewStatus(), 0);

    // Periodically check state (detect manual window resize, etc.)
    const interval = setInterval(checkSplitViewStatus, 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
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
