/**
 * link-view-store
 *
 * The tabs open in the in-app link pane, and which one is showing. A store
 * rather than props because the click can come from anywhere — a note, a
 * task description, a markdown block — while the pane itself is mounted once
 * in the app shell.
 *
 * The tab list IS persisted, so Ctrl+B reopens whatever was there last
 * time. Nothing is loaded at startup, though: the pane begins closed and a
 * webview is only created once it opens, which keeps the original reason
 * this was session-only — no network requests nobody asked for on launch.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The pane's width, in vw. AppContent reserves exactly this much on the
 * pane's side so the page sits beside it rather than under it — the same
 * arrangement the terminal and the task-detail panel already use.
 */
export const LINK_VIEW_SPLIT_WIDTH_VW = 40;

/**
 * Where a tab opened with "+" starts.
 *
 * A search page rather than a blank one: the button exists to go somewhere
 * new, and a blank tab would need an address typed before it did anything.
 */
export const NEW_TAB_URL = 'https://www.google.com/';

/** One page open in the pane. */
export interface LinkTab {
  /** Stable id; also the Tauri webview label suffix. / タブID */
  id: string;
  url: string;
  /** The group it belongs to, or null. Shared ids with the library. / グループ */
  groupId?: string | null;
}

interface LinkViewState {
  /**
   * Whether the pane is on screen. Separate from having tabs so Ctrl+B can
   * hide it and bring the same set back. / ペインの表示状態
   */
  isOpen: boolean;
  tabs: LinkTab[];
  /** The tab on screen, or null when the pane is closed. / 表示中のタブ */
  activeId: string | null;
  /** Open a URL, or focus the tab already showing it. / リンクを開く */
  openLink: (url: string) => void;
  /**
   * Open a new tab at {@link NEW_TAB_URL}.
   *
   * Always adds one, unlike `openLink`, which focuses an existing tab for
   * the same URL — pressing "+" twice must give two tabs even though both
   * start at the same page. / 新しいタブを開く
   */
  newTab: () => void;
  /** Bring a tab to the front. / タブを選択 */
  activateTab: (id: string) => void;
  /** Close one tab; the pane closes with the last one. / タブを閉じる */
  closeTab: (id: string) => void;
  /** Point a tab at a different URL. / タブの遷移先を変える */
  setTabUrl: (id: string, url: string) => void;
  /** Put a tab in a group, or take it out of one. / タブのグループ変更 */
  setTabGroup: (id: string, groupId: string | null) => void;
  /** Show or hide the pane without losing the tabs. / 表示の切り替え */
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  /** Close every tab. / すべて閉じる */
  closeAll: () => void;
}

let nextTabId = 0;

export const useLinkViewStore = create<LinkViewState>()(
  persist(
    (set) => ({
      isOpen: false,
      tabs: [],
      activeId: null,

      openLink: (url) =>
        set((state) => {
          // Re-opening a link that is already here focuses it rather than
          // stacking a second copy of the same page. Opening anything also
          // shows the pane, so a click still works while it is hidden.
          const existing = state.tabs.find((tab) => tab.url === url);
          if (existing) return { activeId: existing.id, isOpen: true };
          const tab: LinkTab = { id: `t${Date.now().toString(36)}${++nextTabId}`, url };
          return { tabs: [...state.tabs, tab], activeId: tab.id, isOpen: true };
        }),

      newTab: () =>
        set((state) => {
          const tab: LinkTab = {
            id: `t${Date.now().toString(36)}${++nextTabId}`,
            url: NEW_TAB_URL,
          };
          return { tabs: [...state.tabs, tab], activeId: tab.id, isOpen: true };
        }),

      activateTab: (id) => set({ activeId: id }),

      closeTab: (id) =>
        set((state) => {
          const index = state.tabs.findIndex((tab) => tab.id === id);
          if (index === -1) return state;
          const tabs = state.tabs.filter((tab) => tab.id !== id);
          if (state.activeId !== id) return { tabs };
          // Focus the neighbour the way a browser does: the one to the
          // right, or the new last tab when the closed one was last.
          const next = tabs[index] ?? tabs[index - 1] ?? null;
          return { tabs, activeId: next?.id ?? null };
        }),

      setTabUrl: (id, url) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, url } : tab)),
        })),

      setTabGroup: (id, groupId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, groupId } : tab)),
        })),

      toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
      setOpen: (open) => set({ isOpen: open }),

      closeAll: () => set({ tabs: [], activeId: null, isOpen: false }),
    }),
    {
      name: 'rapitas-link-view',
      // The tab set is restored so Ctrl+B brings back what was open; the
      // pane itself is not, so nothing loads until it is asked for.
      partialize: (state) => ({ tabs: state.tabs, activeId: state.activeId }),
    },
  ),
);

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
