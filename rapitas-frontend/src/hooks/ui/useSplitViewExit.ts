/**
 * Hook to manage split view exit
 */
import { useEffect } from 'react';
import { isTauri, isSplitViewActive } from '@/utils/tauri';

export function useSplitViewExit() {
  useEffect(() => {
    if (!isTauri()) return;

    // Exit split view with Esc key
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isSplitViewActive()) {
        // handleExitSplitView is removed, so no action here
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return {
    isSplitViewActive: isSplitViewActive(),
  };
}
