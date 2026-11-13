/**
 * navigation-history-sync
 *
 * Keeps useNavigationHistoryStore in step with the browser's session history:
 * wraps history.pushState / replaceState (which the Next.js app router uses for
 * router.push / router.replace) and listens to popstate (browser / OS back and
 * forward, router.back / forward). Each entry the app writes is tagged with its
 * position, so a traversal can be resolved to an exact index instead of being
 * guessed. Not responsible for rendering or for navigating.
 */
import { useEffect } from 'react';
import { useNavigationHistoryStore } from './navigation-history-store';

/** Key of our position tag inside history.state (Next.js keeps its own keys beside it). */
export const NAV_HISTORY_STATE_KEY = '__rapitasNav';

type PositionTag = { sid: string; idx: number };

type Uninstall = () => void;

let uninstallCurrent: Uninstall | null = null;

const currentRoute = (): string => `${window.location.pathname}${window.location.search}`;

const readTag = (state: unknown, sid: string): PositionTag | null => {
  if (!state || typeof state !== 'object') return null;
  const tag = (state as Record<string, unknown>)[NAV_HISTORY_STATE_KEY] as PositionTag | undefined;
  if (!tag || tag.sid !== sid || typeof tag.idx !== 'number') return null;
  return tag;
};

const withTag = (state: unknown, tag: PositionTag): unknown => {
  // NOTE: Non-object states (strings etc.) are left alone — spreading them
  // would change what the writer stored; the store is still updated.
  if (state !== null && state !== undefined && typeof state !== 'object') return state;
  return { ...((state as Record<string, unknown>) ?? {}), [NAV_HISTORY_STATE_KEY]: tag };
};

/**
 * Starts mirroring session history into the store. Idempotent: a second call
 * while installed is a no-op, so React StrictMode's double effects and remounts
 * of the host component cannot stack two wrappers (each would record twice).
 *
 * @returns A function that stops the sync / 同期を止める関数
 */
export function installNavigationHistorySync(): Uninstall {
  if (uninstallCurrent) return uninstallCurrent;

  // A fresh id per document: history.state survives a reload, but the store
  // does not, so tags from before the reload must not be trusted.
  const sid = Math.random().toString(36).slice(2);
  const history = window.history;
  const store = useNavigationHistoryStore.getState;
  const innerPush = history.pushState;
  const innerReplace = history.replaceState;
  let active = true;

  const tagCurrentEntry = (idx: number) => {
    innerReplace.call(history, withTag(history.state, { sid, idx }), '');
  };

  store().reset(currentRoute());
  tagCurrentEntry(0);

  const pushState: History['pushState'] = function (data, unused, url) {
    if (!active) return innerPush.call(history, data, unused, url);
    const idx = store().index + 1;
    innerPush.call(history, withTag(data, { sid, idx }), unused, url);
    store().recordPush(currentRoute());
  };

  const replaceState: History['replaceState'] = function (data, unused, url) {
    if (!active) return innerReplace.call(history, data, unused, url);
    // NOTE: After a traversal Next.js re-writes the entry with the popped
    // state spread in, tag included. Trusting that tag keeps the position
    // right even if this write lands before our popstate listener runs.
    const carried = readTag(data, sid);
    if (carried) store().moveTo(carried.idx);
    const idx = Math.max(store().index, 0);
    innerReplace.call(history, withTag(data, { sid, idx }), unused, url);
    store().recordReplace(currentRoute());
  };

  const onPopState = () => {
    if (!active) return;
    const tag = readTag(history.state, sid);
    if (tag && tag.idx < store().entries.length) {
      store().moveTo(tag.idx);
      store().recordReplace(currentRoute());
      return;
    }
    // An entry we never recorded (before this page load, or written outside
    // the history API): nothing is known around it, so start over from here.
    store().reset(currentRoute());
    tagCurrentEntry(0);
  };

  history.pushState = pushState;
  history.replaceState = replaceState;
  // Capture so the position is updated before the app router's own listener.
  window.addEventListener('popstate', onPopState, true);

  uninstallCurrent = () => {
    active = false;
    window.removeEventListener('popstate', onPopState, true);
    // Only unwrap when nobody wrapped us since; otherwise stay as a passthrough.
    if (history.pushState === pushState) history.pushState = innerPush;
    if (history.replaceState === replaceState) history.replaceState = innerReplace;
    uninstallCurrent = null;
  };
  return uninstallCurrent;
}

/**
 * Installs the history sync once for the app's lifetime. Never uninstalls on
 * unmount: the header (its host) is not rendered on some routes, and history
 * recorded while it is gone is still needed when it comes back.
 */
export function useNavigationHistorySync(): void {
  useEffect(() => {
    installNavigationHistorySync();
  }, []);
}
