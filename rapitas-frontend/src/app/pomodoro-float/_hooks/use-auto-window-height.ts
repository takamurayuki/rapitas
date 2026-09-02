/**
 * useAutoWindowHeight
 *
 * Resizes the Pomodoro floating window to fit its content height (operator
 * request 2026-09-02: no scrollbars — the window adapts instead). Observes the
 * content wrapper and calls the Tauri window API with the CURRENT width kept,
 * so the user's manual width choice survives. No-op outside Tauri.
 */
'use client';

import { useEffect, type RefObject } from 'react';

// Window height bounds: MIN keeps the chrome usable, MAX guards against a
// pathological content burst pushing the window past the screen.
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 1000;

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Keep the window height in sync with the observed element's content height.
 *
 * @param ref - Content wrapper whose natural height drives the window height / ウインドウ高さの基準となるコンテンツ要素
 */
export function useAutoWindowHeight(ref: RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!isTauri() || !el) return;

    let raf = 0;
    let lastApplied = 0;
    const apply = () => {
      raf = 0;
      const target = Math.min(Math.max(Math.ceil(el.scrollHeight), MIN_HEIGHT), MAX_HEIGHT);
      // Re-applying the same height would still nudge a user's manual resize.
      if (target === lastApplied) return;
      lastApplied = target;
      void (async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const { LogicalSize } = await import('@tauri-apps/api/dpi');
        const win = getCurrentWindow();
        const [size, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
        const width = Math.round(size.width / scale);
        await win.setSize(new LogicalSize(width, target));
      })().catch(() => {
        /* window may be mid-close; sizing is best-effort */
      });
    };

    const ro = new ResizeObserver(() => {
      if (!raf) raf = requestAnimationFrame(apply);
    });
    ro.observe(el);
    apply();
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}
