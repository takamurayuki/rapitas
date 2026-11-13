/**
 * navigation-history-store
 *
 * Mirrors the in-app part of the browser's session history (one entry per
 * route: pathname + search) and where the user currently stands in it, so the
 * header's back/forward buttons can show whether there is anywhere to go.
 * Not responsible for observing history changes — useNavigationHistorySync
 * feeds it — nor for navigating; the buttons call router.back()/forward().
 */
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

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
  /** Back past the first entry landed on one we never saw: it becomes entry 0. */
  recordPrepend: (url: string) => void;
  /** Forward past the last entry landed on one we never saw: it becomes the last. */
  recordAppend: (url: string) => void;
  /** Starts over from a single entry (app start, or an entry we never recorded). */
  reset: (url: string) => void;
}

const navigationHistoryStore = createStore<NavigationHistoryState>((set) => ({
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
  recordPrepend: (url) => set((s) => ({ entries: [url, ...s.entries], index: 0 })),
  recordAppend: (url) => set((s) => ({ entries: [...s.entries, url], index: s.entries.length })),
  reset: (url) => set({ entries: [url], index: 0 }),
}));

// NOTE: The Next.js app router calls history.pushState from useInsertionEffect,
// and the sync records it right there. Notifying React subscribers in the same
// call schedules an update inside the insertion phase, which React rejects
// ("useInsertionEffect must not schedule updates"). The state itself still
// changes synchronously — the sync reads it back on the next push — and only
// the notification waits for a microtask, after the commit has finished.
const deferredSubscribe: StoreApi<NavigationHistoryState>['subscribe'] = (listener) =>
  navigationHistoryStore.subscribe((state, previous) => {
    queueMicrotask(() => listener(state, previous));
  });

const reactFacingStore: StoreApi<NavigationHistoryState> = {
  ...navigationHistoryStore,
  subscribe: deferredSubscribe,
};

/**
 * Reads the navigation history store from a component (with a selector), or
 * from anywhere via `.getState()` / `.setState()` like a regular zustand store.
 *
 * @param selector - Picks the slice to subscribe to / 購読する値を選ぶ関数
 * @returns The selected value / 選んだ値
 */
export const useNavigationHistoryStore = Object.assign(
  <T>(selector: (state: NavigationHistoryState) => T): T => useStore(reactFacingStore, selector),
  {
    getState: navigationHistoryStore.getState,
    setState: navigationHistoryStore.setState,
    subscribe: navigationHistoryStore.subscribe,
  },
);

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
