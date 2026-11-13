/**
 * navigation-history-store
 *
 * Mirrors the in-app part of the browser's session history (one entry per
 * route: pathname + search) and where the user currently stands in it, so the
 * header's back/forward buttons can show whether there is anywhere to go.
 * Not responsible for observing history changes — useNavigationHistorySync
 * feeds it — nor for navigating; the buttons call router.back()/forward().
 */
import { create } from 'zustand';

/** Snapshot of the in-app history and the current position in it. */
export interface NavigationHistoryState {
  /** Visited routes in history order (pathname + search). */
  entries: string[];
  /** Position of the current route in `entries`; -1 before the first record. */
  index: number;
  /** A new entry was pushed: drops any forward entries, then appends. */
  recordPush: (url: string) => void;
  /** The current entry was replaced in place (router.replace etc.). */
  recordReplace: (url: string) => void;
  /** A back/forward traversal landed on a known entry. */
  moveTo: (index: number) => void;
  /** Starts over from a single entry (app start, or an entry we never recorded). */
  reset: (url: string) => void;
}

export const useNavigationHistoryStore = create<NavigationHistoryState>((set) => ({
  entries: [],
  index: -1,
  recordPush: (url) =>
    set((s) => {
      const entries = [...s.entries.slice(0, s.index + 1), url];
      return { entries, index: entries.length - 1 };
    }),
  recordReplace: (url) =>
    set((s) => {
      if (s.index < 0) return { entries: [url], index: 0 };
      const entries = [...s.entries];
      entries[s.index] = url;
      return { entries };
    }),
  moveTo: (index) => set((s) => (index >= 0 && index < s.entries.length ? { index } : s)),
  reset: (url) => set({ entries: [url], index: 0 }),
}));

/**
 * Whether there is an in-app entry before the current one.
 *
 * @param s - Store state / ストアの状態
 * @returns true when back navigation stays inside the app / 戻れる場合 true
 */
export const selectCanGoBack = (s: NavigationHistoryState): boolean => s.index > 0;

/**
 * Whether there is an in-app entry after the current one.
 *
 * @param s - Store state / ストアの状態
 * @returns true when forward navigation is possible / 進める場合 true
 */
export const selectCanGoForward = (s: NavigationHistoryState): boolean =>
  s.index >= 0 && s.index < s.entries.length - 1;
