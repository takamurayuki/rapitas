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
import { nextTabMeta, type LinkPageChange } from '@/components/link-view/link-tab-meta';

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

/**
 * Which face the pane is showing.
 *
 * Held here rather than in the host component so "closing means closing"
 * is one rule in one place: the ✕ on the library used to fall back to the
 * page, and closing that page's last tab bounced back into the library,
 * leaving the pane impossible to dismiss.
 */
export type LinkPaneView = 'page' | 'library';

/** One page open in the pane. */
export interface LinkTab {
  /** Stable id; also the Tauri webview label suffix. / タブID */
  id: string;
  url: string;
  /**
   * The page's own title, as the webview reported it. Absent until it
   * does, and dropped again the moment the tab navigates away — a tab must
   * never label the page it has left. / ページタイトル
   */
  title?: string;
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
  /** The open page, or the saved-pages library. / ペインの表示面 */
  view: LinkPaneView;
  /**
   * Groups drawn as a heading only, their members hidden. Ids rather than
   * a flag on the group because collapsing is this pane's state, while a
   * group itself is shared with the saved-pages library. / 折りたたみ中のグループ
   */
  collapsedGroupIds: string[];
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
  /**
   * Record where a tab actually went, as the webview reported it.
   *
   * The counterpart of `setTabUrl`: that one drives the webview, this one
   * follows it — a search run inside the page moves the tab without anyone
   * touching the address bar. / webview 側の遷移を取り込む
   */
  applyPageChange: (id: string, change: LinkPageChange) => void;
  /** Put a tab in a group, or take it out of one. / タブのグループ変更 */
  setTabGroup: (id: string, groupId: string | null) => void;
  /** Draw a group as a heading only, or show its tabs again. / 折りたたみ切替 */
  toggleGroupCollapsed: (groupId: string) => void;
  /** Release every member of a group, keeping the pages open. / グループ解除 */
  ungroupTabs: (groupId: string) => void;
  /** Close every tab in a group. / グループのタブをすべて閉じる */
  closeGroup: (groupId: string) => void;
  /** Show the saved-pages library. / お気に入り一覧を表示 */
  showLibrary: () => void;
  /** Go back to the open page. / 開いているページに戻る */
  showPage: () => void;
  /** Show or hide the pane without losing the tabs. / 表示の切り替え */
  toggleOpen: () => void;
  setOpen: (open: boolean) => void;
  /** Close every tab. / すべて閉じる */
  closeAll: () => void;
}

let nextTabId = 0;

/** The pane shown: on the page it holds, or on the library when it has none. */
function openedPane(tabCount: number): { isOpen: true; view: LinkPaneView } {
  return { isOpen: true, view: tabCount > 0 ? 'page' : 'library' };
}

/** The pane hidden, and reset so it reopens on the page. */
function closedPane(): { isOpen: false; view: LinkPaneView } {
  return { isOpen: false, view: 'page' };
}

export const useLinkViewStore = create<LinkViewState>()(
  persist(
    (set) => ({
      isOpen: false,
      tabs: [],
      activeId: null,
      view: 'page',
      collapsedGroupIds: [],

      openLink: (url) =>
        set((state) => {
          // Re-opening a link that is already here focuses it rather than
          // stacking a second copy of the same page. Opening anything also
          // shows the pane, so a click still works while it is hidden.
          const existing = state.tabs.find((tab) => tab.url === url);
          // Opening a link means showing it, so the library steps aside.
          if (existing) return { activeId: existing.id, isOpen: true, view: 'page' as const };
          const tab: LinkTab = { id: `t${Date.now().toString(36)}${++nextTabId}`, url };
          return {
            tabs: [...state.tabs, tab],
            activeId: tab.id,
            isOpen: true,
            view: 'page' as const,
          };
        }),

      newTab: () =>
        set((state) => {
          const tab: LinkTab = {
            id: `t${Date.now().toString(36)}${++nextTabId}`,
            url: NEW_TAB_URL,
          };
          return {
            tabs: [...state.tabs, tab],
            activeId: tab.id,
            isOpen: true,
            view: 'page' as const,
          };
        }),

      activateTab: (id) => set({ activeId: id }),

      closeTab: (id) =>
        set((state) => {
          const index = state.tabs.findIndex((tab) => tab.id === id);
          if (index === -1) return state;
          const tabs = state.tabs.filter((tab) => tab.id !== id);
          // Nothing left to show, so the pane goes with it. Leaving it open
          // sent it to the library instead, which is what made ✕ unable to
          // dismiss the pane at all.
          if (tabs.length === 0) {
            return { tabs, activeId: null, isOpen: false, view: 'page' as const };
          }
          if (state.activeId !== id) return { tabs };
          // Focus the neighbour the way a browser does: the one to the
          // right, or the new last tab when the closed one was last.
          const next = tabs[index] ?? tabs[index - 1] ?? null;
          return { tabs, activeId: next?.id ?? null };
        }),

      // The title belongs to the page being left, so it goes with it; the
      // webview reports the new one a moment later.
      setTabUrl: (id, url) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, url, title: undefined } : tab)),
        })),

      applyPageChange: (id, change) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === id ? { ...tab, title: undefined, ...nextTabMeta(tab, change) } : tab,
          ),
        })),

      setTabGroup: (id, groupId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, groupId } : tab)),
        })),

      toggleGroupCollapsed: (groupId) =>
        set((state) => ({
          collapsedGroupIds: state.collapsedGroupIds.includes(groupId)
            ? state.collapsedGroupIds.filter((id) => id !== groupId)
            : [...state.collapsedGroupIds, groupId],
        })),

      // Releasing a group keeps its pages — closing them is `closeGroup`.
      // The collapsed flag goes with it: there is no heading left to
      // expand, and a stale id would collapse a group of the same name
      // created later.
      ungroupTabs: (groupId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.groupId === groupId ? { ...tab, groupId: null } : tab,
          ),
          collapsedGroupIds: state.collapsedGroupIds.filter((id) => id !== groupId),
        })),

      closeGroup: (groupId) =>
        set((state) => {
          const tabs = state.tabs.filter((tab) => tab.groupId !== groupId);
          if (tabs.length === state.tabs.length) return state;
          const collapsedGroupIds = state.collapsedGroupIds.filter((id) => id !== groupId);
          // Same rule as closing the last tab: nothing left to show means
          // the pane goes too.
          if (tabs.length === 0) {
            return {
              tabs,
              activeId: null,
              isOpen: false,
              view: 'page' as const,
              collapsedGroupIds,
            };
          }
          const stillThere = tabs.some((tab) => tab.id === state.activeId);
          return {
            tabs,
            collapsedGroupIds,
            activeId: stillThere ? state.activeId : tabs[0].id,
          };
        }),

      showLibrary: () => set({ view: 'library' }),
      showPage: () => set({ view: 'page' }),

      // Opening always lands on the page, except when there is none —
      // Ctrl+B on an empty pane has nothing to show but the library, which
      // is where a saved page is picked (#1074). Closing resets the face so
      // the pane never reopens on the library it was dismissed from.
      toggleOpen: () =>
        set((state) => (state.isOpen ? closedPane() : openedPane(state.tabs.length))),
      setOpen: (open) => set((state) => (open ? openedPane(state.tabs.length) : closedPane())),

      closeAll: () => set({ tabs: [], activeId: null, isOpen: false, view: 'page' }),
    }),
    {
      name: 'rapitas-link-view',
      // The tab set is restored so Ctrl+B brings back what was open; the
      // pane itself is not, so nothing loads until it is asked for.
      partialize: (state) => ({
        tabs: state.tabs,
        activeId: state.activeId,
        collapsedGroupIds: state.collapsedGroupIds,
      }),
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
