/**
 * useFloatPageBackground
 *
 * Makes the html/body of the /pomodoro-float route transparent while glass
 * mode is active. globals.css paints `body { background: var(--background) }`
 * on every page unconditionally, which otherwise fills the WebView opaque and
 * defeats the window's `.transparent(true)` — so the OS composites a solid
 * page instead of the desktop behind it. Scoped to inline style on this route
 * only; the global stylesheet is left untouched so no other page is affected.
 */
'use client';

import { useEffect } from 'react';
import type { TransparencyMode } from './use-transparency-mode';

/**
 * Overrides html/body background to transparent in glass mode, restores the
 * stylesheet default otherwise. Cleans up on unmount.
 *
 * @param mode - Current transparency mode / 現在の透過モード
 */
export function useFloatPageBackground(mode: TransparencyMode): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const html = document.documentElement;
    const body = document.body;

    const clear = () => {
      html.style.removeProperty('background');
      body.style.removeProperty('background');
    };

    if (mode === 'glass') {
      html.style.setProperty('background', 'transparent');
      body.style.setProperty('background', 'transparent');
    } else {
      clear();
    }

    return clear;
  }, [mode]);
}
