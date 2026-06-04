/**
 * terminal-store
 *
 * UI state for the integrated terminal: panel open/height plus the in-memory
 * tab/pane layout. Only the panel preferences (open, height) are persisted —
 * PTYs cannot survive a reload, so tabs/panes are intentionally session-scoped
 * and recreated fresh after a full reload.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SplitDirection, TabState } from './terminal.types';
import { closeTerminal } from './terminal-ipc';
import { getTerminalContext } from './terminal-context-store';

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 900;
const DEFAULT_HEIGHT = 300;

const newId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

function makeTab(index: number, opts?: { cwd?: string; title?: string }): TabState {
  const paneId = newId();
  return {
    id: newId(),
    title: opts?.title ?? `Terminal ${index}`,
    cwd: opts?.cwd,
    direction: 'row',
    panes: [{ id: paneId }],
    activePaneId: paneId,
  };
}

interface TerminalStore {
  isOpen: boolean;
  height: number;
  tabs: TabState[];
  activeTabId: string | null;

  toggle: () => void;
  open: () => void;
  close: () => void;
  setHeight: (height: number) => void;

  addTab: () => void;
  openTerminalForTask: (opts: { cwd?: string; title?: string }) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;

  splitActivePane: (direction?: SplitDirection) => void;
  closePane: (tabId: string, paneId: string) => void;
  setActivePane: (tabId: string, paneId: string) => void;
}

/** Append a fresh tab and make it active. Used by open()/addTab(). */
function appendTab(
  tabs: TabState[],
  opts?: { cwd?: string; title?: string },
): { tabs: TabState[]; activeTabId: string } {
  const tab = makeTab(tabs.length + 1, opts);
  return { tabs: [...tabs, tab], activeTabId: tab.id };
}

export const useTerminalStore = create<TerminalStore>()(
  persist(
    (set, get) => ({
      isOpen: false,
      height: DEFAULT_HEIGHT,
      tabs: [],
      activeTabId: null,

      toggle: () => (get().isOpen ? get().close() : get().open()),

      open: () =>
        set((state) => {
          // Honour the current view's working-directory context: open (or
          // re-focus) a tab rooted there so Ctrl+J lands in the right dir.
          const { cwd, title } = getTerminalContext();
          if (cwd) {
            const existing = state.tabs.find((t) => t.cwd === cwd);
            if (existing) {
              return { isOpen: true, activeTabId: existing.id };
            }
            return { isOpen: true, ...appendTab(state.tabs, { cwd, title: title ?? undefined }) };
          }
          // No context: open the existing tabs, or spin up a default one.
          if (state.tabs.length === 0) {
            return { isOpen: true, ...appendTab(state.tabs) };
          }
          return { isOpen: true };
        }),

      close: () => set({ isOpen: false }),

      setHeight: (height) => set({ height: Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height)) }),

      addTab: () => set((state) => appendTab(state.tabs)),

      // Open the panel and spawn a new tab bound to a task's working directory.
      openTerminalForTask: (opts) =>
        set((state) => ({ isOpen: true, ...appendTab(state.tabs, opts) })),

      closeTab: (tabId) =>
        set((state) => {
          const tab = state.tabs.find((t) => t.id === tabId);
          // Kill every PTY the tab owned so no shell is orphaned.
          tab?.panes.forEach((p) => closeTerminal(p.id).catch(() => {}));
          const tabs = state.tabs.filter((t) => t.id !== tabId);
          const activeTabId =
            state.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId;
          return { tabs, activeTabId, isOpen: tabs.length > 0 && state.isOpen };
        }),

      setActiveTab: (tabId) => set({ activeTabId: tabId }),

      splitActivePane: (direction) =>
        set((state) => {
          const paneId = newId();
          const tabs = state.tabs.map((tab) => {
            if (tab.id !== state.activeTabId) return tab;
            return {
              ...tab,
              direction: direction ?? tab.direction,
              panes: [...tab.panes, { id: paneId }],
              activePaneId: paneId,
            };
          });
          return { tabs };
        }),

      closePane: (tabId, paneId) =>
        set((state) => {
          closeTerminal(paneId).catch(() => {});
          let removedLastPane = false;
          const tabs = state.tabs
            .map((tab) => {
              if (tab.id !== tabId) return tab;
              const panes = tab.panes.filter((p) => p.id !== paneId);
              if (panes.length === 0) {
                removedLastPane = true;
                return tab; // marked for removal below
              }
              const activePaneId =
                tab.activePaneId === paneId ? panes[panes.length - 1].id : tab.activePaneId;
              return { ...tab, panes, activePaneId };
            })
            // Closing the last pane closes the whole tab.
            .filter((tab) => !(removedLastPane && tab.id === tabId));
          const activeTabId =
            removedLastPane && state.activeTabId === tabId
              ? (tabs[tabs.length - 1]?.id ?? null)
              : state.activeTabId;
          return { tabs, activeTabId, isOpen: tabs.length > 0 && state.isOpen };
        }),

      setActivePane: (tabId, paneId) =>
        set((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, activePaneId: paneId } : tab,
          ),
        })),
    }),
    {
      name: 'rapitas-terminal',
      // Persist only panel prefs; tabs/panes are session-scoped (PTYs die on reload).
      partialize: (state) => ({ height: state.height }),
    },
  ),
);
