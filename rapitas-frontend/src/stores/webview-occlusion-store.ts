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

let nextOccluderId = 0;

/**
 * Register an overlay as covering the webview while `isOpen` is true.
 *
 * Each caller gets its own id, so two menus open at once both count and
 * closing one does not reveal the webview under the other.
 *
 * @param isOpen - Whether the overlay is on screen now / 表示中か
 */
export function useOccludesWebview(isOpen: boolean): void {
  useEffect(() => {
    if (!isOpen) return;
    const id = `occluder-${++nextOccluderId}`;
    const { add, remove } = useWebviewOcclusionStore.getState();
    add(id);
    return () => remove(id);
  }, [isOpen]);
}
