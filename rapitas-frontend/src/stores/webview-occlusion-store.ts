/**
 * webview-occlusion-store
 *
 * Counts the HTML overlays currently open that could sit on top of the
 * in-app browser's webview — an unpinned side nav, a header dropdown, a
 * dialog. A Tauri child webview is an OS surface painted above every HTML
 * element regardless of z-index, so while anything is registered here the
 * webview is hidden and the overlay shows.
 *
 * Not responsible for hiding anything itself: `useLinkView`'s single
 * `applyVisibility` reads the count as one of its inputs. Sending "hide"
 * from here directly would race the bounds sync that shows it again.
 */
import { useEffect } from 'react';
import { create } from 'zustand';

interface WebviewOcclusionState {
  /** Ids of the overlays currently open. / 開いている重なり要素 */
  occluders: string[];
  add: (id: string) => void;
  remove: (id: string) => void;
}

export const useWebviewOcclusionStore = create<WebviewOcclusionState>()((set) => ({
  occluders: [],
  add: (id) => set((s) => (s.occluders.includes(id) ? s : { occluders: [...s.occluders, id] })),
  remove: (id) =>
    set((s) => (s.occluders.includes(id) ? { occluders: s.occluders.filter((o) => o !== id) } : s)),
}));

/**
 * What an overlay is, for ラピ's window on the desktop (#1541). All three
 * hide the in-app browser alike.
 *
 * - `menu`: the bell, the side nav, a dropdown — she stays as she is, as in
 *   the browser build, where she is drawn above them too.
 * - `dialog`: she is hidden, so she never sits on top of one.
 * - `blocking`: the restart overlay — she stays in sight but takes no press
 *   or drag, since the app under her is going away.
 */
export type OccluderKind = 'menu' | 'dialog' | 'blocking';

/** How ラピ is drawn given the overlays open now. */
export type RapiPresence = 'shown' | 'inert' | 'hidden';

/**
 * How ラピ should be drawn while these overlays are open.
 *
 * @param occluders - Ids in the store, each prefixed with its kind / 登録中のID
 * @returns shown, inert (seen but not pressable) or hidden / 表示状態
 */
export function rapiPresenceOf(occluders: readonly string[]): RapiPresence {
  const kinds = occluders.map((id) => id.split('-')[0]);
  if (kinds.includes('dialog')) return 'hidden';
  if (kinds.includes('blocking')) return 'inert';
  return 'shown';
}

let nextOccluderId = 0;

/**
 * Register an overlay as covering the webview while `isOpen` is true.
 *
 * Each caller gets its own id, so two menus open at once both count and
 * closing one does not reveal the webview under the other. The id starts
 * with the kind, which is how `rapiPresenceOf` tells them apart.
 *
 * @param isOpen - Whether the overlay is on screen now / 表示中か
 * @param kind - What the overlay is; a menu unless said otherwise / 種類
 */
export function useOccludesWebview(isOpen: boolean, kind: OccluderKind = 'menu'): void {
  useEffect(() => {
    if (!isOpen) return;
    const id = `${kind}-${++nextOccluderId}`;
    const { add, remove } = useWebviewOcclusionStore.getState();
    add(id);
    return () => remove(id);
  }, [isOpen, kind]);
}
