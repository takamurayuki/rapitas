/**
 * useAutoWindowHeight
 *
 * Fits the Pomodoro floating window's height to its content at discrete
 * moments only: mount, window show, and layout-changing state flips the
 * caller lists in `deps`. Deliberately NO ResizeObserver — continuous
 * observation created resize feedback loops that pegged WebView2 at multiple
 * cores twice on 2026-09-02; with one-shot fits a loop is structurally
 * impossible. No-op outside Tauri.
 */
'use client';

import { useEffect, type RefObject } from 'react';

// Window height bounds: MIN keeps the chrome usable, MAX guards against a
// pathological content burst pushing the window past the screen.
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 1000;

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Fit the window height to the observed element's content height once per
 * trigger: on mount, on each show, and whenever `deps` change.
 *
 * @param ref - Content wrapper whose natural height drives the window height / ウインドウ高さの基準となるコンテンツ要素
 * @param deps - Layout-changing state (e.g. idle/running, focus mode) / 再フィットを起こすレイアウト状態
 */
export function useAutoWindowHeight(ref: RefObject<HTMLDivElement | null>, deps: unknown[]): void {
  useEffect(() => {
    const el = ref.current;
    if (!isTauri() || !el) return;

    let cancelled = false;
    const fit = async () => {
      // Double rAF: let the triggering render actually lay out first.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (cancelled) return;
      const target = Math.min(Math.max(Math.ceil(el.scrollHeight), MIN_HEIGHT), MAX_HEIGHT);
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const { PhysicalSize } = await import('@tauri-apps/api/dpi');
      const win = getCurrentWindow();
      const [size, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
      const targetPhysical = Math.round(target * scale);
      if (Math.abs(size.height - targetPhysical) <= 2 * scale) return;
      // Width passes through as the exact physical value — a logical round
      // trip drifts on fractional DPI scales.
      await win.setSize(new PhysicalSize(size.width, targetPhysical));
    };
    void fit().catch(() => {
      /* window may be mid-close; sizing is best-effort */
    });

    // Re-fit on show: the window is long-lived (hidden, never destroyed), so
    // a manual resize would otherwise stick for every later open.
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<boolean>('pomodoro-float://visibility-changed', (event) => {
        if (event.payload)
          void fit().catch(() => {
            /* best-effort */
          });
      }).then((fn) => {
        unlisten = fn;
      });
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's trigger list
  }, [ref, ...deps]);
}
