/**
 * link-view-store
 *
 * The tabs open in the in-app link pane, and which one is showing. A store
 * rather than props because the click can come from anywhere — a note, a
 * task description, a markdown block — while the pane itself is mounted once
 * in the app shell.
 *
 * Deliberately not persisted: a docked page is part of the current session,
 * and restoring a set of them on launch would open network requests nobody
 * asked for.
 */
import { create } from 'zustand';

/**
 * The pane's width, in vw. AppContent reserves exactly this much on the
 * pane's side so the page sits beside it rather than under it — the same
 * arrangement the terminal and the task-detail panel already use.
 */
export const LINK_VIEW_SPLIT_WIDTH_VW = 40;

/** One page open in the pane. */
export interface LinkTab {
  /** Stable id; also the Tauri webview label suffix. / タブID */
  id: string;
  url: string;
}

interface LinkViewState {
  tabs: LinkTab[];
  /** The tab on screen, or null when the pane is closed. / 表示中のタブ */
  activeId: string | null;
  /** Open a URL, or focus the tab already showing it. / リンクを開く */
  openLink: (url: string) => void;
  /** Bring a tab to the front. / タブを選択 */
  activateTab: (id: string) => void;
  /** Close one tab; the pane closes with the last one. / タブを閉じる */
  closeTab: (id: string) => void;
  /** Close every tab. / すべて閉じる */
  closeAll: () => void;
}

let nextTabId = 0;

export const useLinkViewStore = create<LinkViewState>((set) => ({
  tabs: [],
  activeId: null,

  openLink: (url) =>
    set((state) => {
      // Re-opening a link that is already here focuses it rather than
      // stacking a second copy of the same page.
      const existing = state.tabs.find((tab) => tab.url === url);
      if (existing) return { activeId: existing.id };
      const tab: LinkTab = { id: `t${++nextTabId}`, url };
      return { tabs: [...state.tabs, tab], activeId: tab.id };
    }),

  activateTab: (id) => set({ activeId: id }),

  closeTab: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      if (state.activeId !== id) return { tabs };
      // Focus the neighbour the way a browser does: the one to the right,
      // or the new last tab when the closed one was last.
      const next = tabs[index] ?? tabs[index - 1] ?? null;
      return { tabs, activeId: next?.id ?? null };
    }),

  closeAll: () => set({ tabs: [], activeId: null }),
}));

/**
 * Open a URL in the pane from outside React.
 *
 * `external-links.ts` routes plain DOM clicks and has no hook context, so it
 * reaches the store through this rather than through `useLinkViewStore`.
 *
 * @param url - The link to show in the pane / ペインに表示するリンク
 */
export function openLinkInPane(url: string): void {
  useLinkViewStore.getState().openLink(url);
}
