'use client';

import { useEffect } from 'react';
import { useAppVisibility } from '@/hooks/common/useAppVisibility';

/**
 * AppVisibilityBridge
 *
 * Mirrors useAppVisibility's hidden state onto <html data-app-hidden> so
 * globals.css can pause decorative animations while the window is minimized.
 * This is the single mount point for useAppVisibility's Tauri subscription —
 * other consumers should read app-visibility-store's getAppHidden() instead
 * of calling the hook again.
 */
export default function AppVisibilityBridge() {
  const hidden = useAppVisibility();

  useEffect(() => {
    if (hidden) {
      document.documentElement.setAttribute('data-app-hidden', 'true');
    } else {
      document.documentElement.removeAttribute('data-app-hidden');
    }
  }, [hidden]);

  return null;
}
