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

/** The tag of any document's sync (not only this one), or null. */
const readAnyTag = (state: unknown): PositionTag | null => {
  if (!state || typeof state !== 'object') return null;
  const tag = (state as Record<string, unknown>)[NAV_HISTORY_STATE_KEY] as PositionTag | undefined;
  if (!tag || typeof tag.sid !== 'string' || typeof tag.idx !== 'number') return null;
  return tag;
};

const readTag = (state: unknown, sid: string): PositionTag | null => {
  const tag = readAnyTag(state);
  return tag && tag.sid === sid ? tag : null;
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

  const history = window.history;
  const store = useNavigationHistoryStore.getState;
  const innerPush = history.pushState;
  const innerReplace = history.replaceState;
  let active = true;
  // A fresh id per document: history.state survives a reload, but the store
  // does not, so tags from before the reload must not be trusted.
  let sid = '';
  // NOTE: Tags hold absolute positions; store index i sits at position
  // base + i. Entries found before the first one we recorded get negative
  // positions (base goes down) instead of renumbering, because tags already
  // written into other history entries can never be rewritten — resetting the
  // numbering is what broke the round trip across an unrecorded entry.
  let base = 0;
  // Whatever tag the start entry carried before we overwrote it (e.g. from
  // the document before a reload); orders an unknown neighbour when there
  // is only one entry to compare against.
  let originTag: PositionTag | null = null;
  // Entries after the recorded range can only be left over from before a
  // reload, and the first push drops them for good.
  let forwardMayExist = true;
  // NOTE: A multi-step jump past several unrecorded entries still records
  // only the one it lands on, next to the range; positions further out can't
  // be known from the History API alone.

  const tagCurrentEntry = (idx: number) => {
    innerReplace.call(history, withTag(history.state, { sid, idx }), '');
  };

  const restart = () => {
    originTag = readAnyTag(history.state);
    sid = Math.random().toString(36).slice(2);
    base = 0;
    forwardMayExist = true;
    store().reset(currentRoute());
    tagCurrentEntry(0);
  };

  /** Which side of the recorded range an unrecorded entry we just landed on lies. */
  const sideOfUnknown = (): 'before' | 'after' | null => {
    const { index, entries } = store();
    const last = entries.length - 1;
    // Traversing from inside the range lands on a tagged entry, so an
    // untagged one is only reachable from an end of it (a multi-step jump,
    // e.g. the back button's long-press menu, can come from either end).
    if (index !== 0 && index !== last) return null;
    if (!forwardMayExist) return 'before';
    const landed = readAnyTag(history.state);
    if (originTag && landed && landed.sid === originTag.sid) {
      return landed.idx > originTag.idx ? 'after' : 'before';
    }
    return index === last && last > 0 ? 'after' : 'before';
  };

  restart();

  const pushState: History['pushState'] = function (data, unused, url) {
    if (!active) return innerPush.call(history, data, unused, url);
    const idx = base + store().index + 1;
    innerPush.call(history, withTag(data, { sid, idx }), unused, url);
    forwardMayExist = false;
    store().recordPush(currentRoute());
  };

  const replaceState: History['replaceState'] = function (data, unused, url) {
    if (!active) return innerReplace.call(history, data, unused, url);
    // NOTE: After a traversal Next.js re-writes the entry with the popped
    // state spread in, tag included. Trusting that tag keeps the position
    // right even if this write lands before our popstate listener runs.
    const carried = readTag(data, sid);
    if (carried) store().moveTo(carried.idx - base);
    const idx = base + Math.max(store().index, 0);
    innerReplace.call(history, withTag(data, { sid, idx }), unused, url);
    store().recordReplace(currentRoute());
  };

  const onPopState = () => {
    if (!active) return;
    const tag = readTag(history.state, sid);
    const known = tag ? tag.idx - base : -1;
    if (tag && known >= 0 && known < store().entries.length) {
      store().moveTo(known);
      store().recordReplace(currentRoute());
      return;
    }
    // An entry we never recorded (before this page load, or from the document
    // before a reload): extend the range on the side it lies, and tag it so
    // coming back to it later resolves like any other entry.
    const side = sideOfUnknown();
    if (side === 'before') {
      store().recordPrepend(currentRoute());
      base -= 1;
      tagCurrentEntry(base);
    } else if (side === 'after') {
      store().recordAppend(currentRoute());
      tagCurrentEntry(base + store().index);
    } else {
      // Inside the range yet untagged (written outside the history API):
      // nothing around it is known, so start a new numbering from here.
      restart();
    }
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
