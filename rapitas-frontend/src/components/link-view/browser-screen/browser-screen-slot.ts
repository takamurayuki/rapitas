/**
 * browser-screen-slot
 *
 * The /browser page only renders an empty slot; LinkViewHost — the single
 * owner of the docked webviews — portals the browser screen into it. This
 * tiny store is how the host learns which element the slot is, without the
 * page having to own (and on unmount destroy) any webview.
 */
import { create } from 'zustand';

interface BrowserScreenSlotState {
  /** The mounted slot element, or null when /browser is not shown. */
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
}

export const useBrowserScreenSlotStore = create<BrowserScreenSlotState>()((set) => ({
  slot: null,
  setSlot: (el) => set({ slot: el }),
}));

/** The route the full-screen browser lives on. */
export const BROWSER_ROUTE = '/browser';

/**
 * Whether a pathname is the browser screen.
 *
 * @param pathname - The current route / 現在のパス
 * @returns True on /browser (trailing slash tolerated for static export) / /browser なら true
 */
export function isBrowserRoute(pathname: string | null | undefined): boolean {
  return pathname === BROWSER_ROUTE || pathname === `${BROWSER_ROUTE}/`;
}
