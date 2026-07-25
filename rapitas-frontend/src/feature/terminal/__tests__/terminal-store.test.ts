import { vi } from 'vitest';

// The store calls closeTerminal() (Tauri invoke) when panes/tabs close; stub it
// so the state logic can be tested without a Tauri runtime.
vi.mock('../terminal-ipc', () => ({
  closeTerminal: vi.fn(() => Promise.resolve()),
  isTauri: () => false,
}));

import { useTerminalStore } from '../terminal-store';
import { useTerminalContextStore } from '../terminal-context-store';
import { closeTerminal } from '../terminal-ipc';

function resetStores() {
  useTerminalStore.setState({
    isOpen: false,
    height: 300,
    displayMode: 'overlay',
    dockSide: 'right',
    splitWidthPercent: 50,
    tabs: [],
    activeTabId: null,
  });
  useTerminalContextStore.setState({ cwd: null, title: null });
  vi.clearAllMocks();
}

const store = () => useTerminalStore.getState();

describe('terminalStore', () => {
  beforeEach(resetStores);

  it('starts closed with no tabs', () => {
    expect(store().isOpen).toBe(false);
    expect(store().tabs).toHaveLength(0);
    expect(store().activeTabId).toBeNull();
  });

  it('open() with no context creates and activates the first tab', () => {
    store().open();
    const s = store();
    expect(s.isOpen).toBe(true);
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTabId).toBe(s.tabs[0].id);
    expect(s.tabs[0].panes).toHaveLength(1);
    expect(s.tabs[0].cwd).toBeUndefined();
  });

  it('open() with existing tabs just reopens (no new tab)', () => {
    store().open(); // creates tab #1
    const firstId = store().tabs[0].id;
    store().close();
    store().open();
    expect(store().isOpen).toBe(true);
    expect(store().tabs).toHaveLength(1);
    expect(store().activeTabId).toBe(firstId);
  });

  it('open() with a cwd context creates a tab rooted at that directory', () => {
    useTerminalContextStore.getState().setTerminalContext({ cwd: '/proj/a', title: 'Theme A' });
    store().open();
    const tab = store().tabs[0];
    expect(tab.cwd).toBe('/proj/a');
    expect(tab.title).toBe('Theme A');
    expect(store().activeTabId).toBe(tab.id);
  });

  it('open() reuses an existing tab with the same cwd instead of duplicating', () => {
    useTerminalContextStore.getState().setTerminalContext({ cwd: '/proj/a', title: 'Theme A' });
    store().open();
    const tabId = store().tabs[0].id;
    store().close();
    // Same context again → should re-focus the same tab, not spawn a second.
    store().open();
    expect(store().tabs).toHaveLength(1);
    expect(store().activeTabId).toBe(tabId);
  });

  it('toggle() opens when closed and closes when open', () => {
    store().toggle();
    expect(store().isOpen).toBe(true);
    store().toggle();
    expect(store().isOpen).toBe(false);
  });

  it('addTab() appends a tab and makes it active', () => {
    store().open();
    store().addTab();
    const s = store();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeTabId).toBe(s.tabs[1].id);
  });

  it('addTab() opens the new tab in the current working-directory context', () => {
    store().open(); // first (generic) tab
    useTerminalContextStore.getState().setTerminalContext({ cwd: '/proj/b', title: 'Theme B' });
    store().addTab();
    const s = store();
    const newTab = s.tabs[s.tabs.length - 1];
    expect(newTab.cwd).toBe('/proj/b');
    expect(newTab.title).toBe('Theme B');
    expect(s.activeTabId).toBe(newTab.id);
  });

  it('splitActivePane() adds a pane to the active tab and sets direction', () => {
    store().open();
    const tabId = store().activeTabId!;
    store().splitActivePane('column');
    const tab = store().tabs.find((t) => t.id === tabId)!;
    expect(tab.panes).toHaveLength(2);
    expect(tab.direction).toBe('column');
    expect(tab.activePaneId).toBe(tab.panes[1].id);
  });

  it('closePane() removes a pane, reassigns the active pane, and kills its PTY', () => {
    store().open();
    const tabId = store().activeTabId!;
    store().splitActivePane('row');
    const tab = store().tabs.find((t) => t.id === tabId)!;
    const [firstPane, secondPane] = tab.panes;
    store().closePane(tabId, secondPane.id);
    const updated = store().tabs.find((t) => t.id === tabId)!;
    expect(updated.panes).toHaveLength(1);
    expect(updated.activePaneId).toBe(firstPane.id);
    expect(closeTerminal).toHaveBeenCalledWith(secondPane.id);
  });

  it('closePane() on the last pane closes the whole tab', () => {
    store().open();
    store().addTab(); // now 2 tabs
    const tabs = store().tabs;
    const target = tabs[1];
    store().closePane(target.id, target.panes[0].id);
    expect(store().tabs.map((t) => t.id)).not.toContain(target.id);
    expect(store().tabs).toHaveLength(1);
    expect(store().activeTabId).toBe(tabs[0].id);
  });

  it('closeTab() removes the tab, reassigns active, and closes panel when empty', () => {
    store().open();
    const onlyTab = store().tabs[0];
    store().closeTab(onlyTab.id);
    expect(store().tabs).toHaveLength(0);
    expect(store().activeTabId).toBeNull();
    expect(store().isOpen).toBe(false);
    expect(closeTerminal).toHaveBeenCalledWith(onlyTab.panes[0].id);
  });

  it('setActiveTab() and setActivePane() update selection', () => {
    store().open();
    store().addTab();
    const [tabA, tabB] = store().tabs;
    store().setActiveTab(tabA.id);
    expect(store().activeTabId).toBe(tabA.id);
    store().splitActivePane('row'); // tabA now has 2 panes; active = the new one
    const refreshedA = store().tabs.find((t) => t.id === tabA.id)!;
    store().setActivePane(tabA.id, refreshedA.panes[0].id);
    expect(store().tabs.find((t) => t.id === tabA.id)!.activePaneId).toBe(refreshedA.panes[0].id);
    expect(tabB).toBeDefined();
  });

  describe('split display mode', () => {
    it('defaults to overlay, docked right, at 50% width', () => {
      expect(store().displayMode).toBe('overlay');
      expect(store().dockSide).toBe('right');
      expect(store().splitWidthPercent).toBe(50);
    });

    it('setDisplayMode() switches between overlay and split', () => {
      store().setDisplayMode('split');
      expect(store().displayMode).toBe('split');
      store().setDisplayMode('overlay');
      expect(store().displayMode).toBe('overlay');
    });

    it('setDockSide() sets an explicit side', () => {
      store().setDockSide('left');
      expect(store().dockSide).toBe('left');
      store().setDockSide('right');
      expect(store().dockSide).toBe('right');
    });

    it('toggleDockSide() flips right <-> left', () => {
      expect(store().dockSide).toBe('right');
      store().toggleDockSide();
      expect(store().dockSide).toBe('left');
      store().toggleDockSide();
      expect(store().dockSide).toBe('right');
    });

    it('setSplitWidthPercent() clamps to the [20, 80] range', () => {
      store().setSplitWidthPercent(5);
      expect(store().splitWidthPercent).toBe(20);
      store().setSplitWidthPercent(95);
      expect(store().splitWidthPercent).toBe(80);
      store().setSplitWidthPercent(35);
      expect(store().splitWidthPercent).toBe(35);
    });
  });
});
