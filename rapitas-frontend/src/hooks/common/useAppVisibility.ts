'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { getAppHidden, setAppHidden, subscribeAppHidden } from './app-visibility-store';

/**
 * useAppVisibility
 *
 * Subscribes to the Tauri `app://visibility` event (emitted from main.rs on
 * window minimize/restore) and reflects it into the app-visibility-store.
 * occlusion is disabled to work around a WebView2 black-screen bug, so
 * document.visibilityState stays 'visible' even while minimized — this hook
 * is the only reliable hidden signal and must not fall back to
 * visibilitychange. No-ops outside Tauri (SSR, browser, tests).
 *
 * @returns Whether the app window is currently minimized/hidden / アプリウィンドウが現在最小化中かどうか
 */
export function useAppVisibility(): boolean {
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const fn = await listen<{ hidden: boolean }>('app://visibility', (event) => {
        setAppHidden(!!event.payload?.hidden);
      });
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return useSyncExternalStore(subscribeAppHidden, getAppHidden, () => false);
}
