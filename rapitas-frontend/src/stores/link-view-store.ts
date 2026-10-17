/**
 * link-view-store
 *
 * The one URL currently docked in the in-app link pane. A store rather than
 * props because the click can come from anywhere — a note, a task
 * description, a markdown block — while the pane itself is mounted once in
 * the app shell.
 *
 * Deliberately not persisted: a docked page is part of the current session,
 * and restoring one on launch would open a network request nobody asked for.
 */
import { create } from 'zustand';

/**
 * The pane's width, in vw. AppContent reserves exactly this much so the page
 * sits beside the pane rather than under it — the same arrangement the
 * terminal and the task-detail panel already use.
 */
export const LINK_VIEW_SPLIT_WIDTH_VW = 40;

interface LinkViewState {
  /** The docked URL, or null when the pane is closed. / 表示中のURL */
  url: string | null;
  /** Dock a URL, replacing whatever is there. / リンクを表示する */
  openLink: (url: string) => void;
  /** Close the pane. / ペインを閉じる */
  closeLink: () => void;
}

export const useLinkViewStore = create<LinkViewState>((set) => ({
  url: null,
  openLink: (url) => set({ url }),
  closeLink: () => set({ url: null }),
}));

/**
 * Dock a URL from outside React.
 *
 * `external-links.ts` routes plain DOM clicks and has no hook context, so it
 * reaches the store through this rather than through `useLinkViewStore`.
 *
 * @param url - The link to show in the pane / ペインに表示するリンク
 */
export function openLinkInPane(url: string): void {
  useLinkViewStore.getState().openLink(url);
}
