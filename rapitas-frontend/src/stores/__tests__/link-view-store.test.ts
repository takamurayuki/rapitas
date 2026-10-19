/**
 * link-view-store.test
 *
 * Tabs are only useful if opening the same link twice does not stack
 * duplicates and closing one lands somewhere sensible — both are what makes
 * the pane feel like a browser rather than a list that grows.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useLinkViewStore,
  openLinkInPane,
  LINK_VIEW_SPLIT_WIDTH_VW,
  NEW_TAB_URL,
} from '../link-view-store';
import { linkPaneSide, linkPaneWidthVw } from '@/components/link-view/LinkViewHost';
import { TASK_DETAIL_SPLIT_WIDTH_VW } from '../task-detail-visibility-store';

const state = () => useLinkViewStore.getState();
const urls = () => state().tabs.map((t) => t.url);

// Module scope: a beforeEach inside one describe does not reach the others,
// and state then leaks between them.
beforeEach(() => {
  useLinkViewStore.setState({ tabs: [], activeId: null, isOpen: false, view: 'page' });
});

describe('link-view-store', () => {
  it('starts closed', () => {
    expect(state().tabs).toEqual([]);
    expect(state().activeId).toBeNull();
  });

  it('opens a tab and makes it active', () => {
    state().openLink('https://a.example');
    expect(urls()).toEqual(['https://a.example']);
    expect(state().activeId).toBe(state().tabs[0].id);
  });

  it('keeps several tabs, newest last', () => {
    state().openLink('https://a.example');
    state().openLink('https://b.example');
    expect(urls()).toEqual(['https://a.example', 'https://b.example']);
  });

  // Re-opening the same link from another note should go to the page that is
  // already there, not pile up identical tabs.
  it('focuses the existing tab instead of duplicating a URL', () => {
    state().openLink('https://a.example');
    const first = state().tabs[0].id;
    state().openLink('https://b.example');
    state().openLink('https://a.example');
    expect(urls()).toEqual(['https://a.example', 'https://b.example']);
    expect(state().activeId).toBe(first);
  });

  it('gives every tab its own id', () => {
    state().openLink('https://a.example');
    state().openLink('https://b.example');
    const [a, b] = state().tabs;
    expect(a.id).not.toBe(b.id);
  });

  it('closes a background tab without changing which is active', () => {
    state().openLink('https://a.example');
    state().openLink('https://b.example');
    const active = state().activeId;
    state().closeTab(state().tabs[0].id);
    expect(urls()).toEqual(['https://b.example']);
    expect(state().activeId).toBe(active);
  });

  it('moves to the neighbour on the right when the active tab closes', () => {
    state().openLink('https://a.example');
    state().openLink('https://b.example');
    state().openLink('https://c.example');
    state().activateTab(state().tabs[1].id);
    state().closeTab(state().tabs[1].id);
    expect(state().tabs[state().tabs.findIndex((t) => t.id === state().activeId)].url).toBe(
      'https://c.example',
    );
  });

  it('falls back to the left when the last tab closes', () => {
    state().openLink('https://a.example');
    state().openLink('https://b.example');
    state().closeTab(state().tabs[1].id);
    expect(urls()).toEqual(['https://a.example']);
    expect(state().activeId).toBe(state().tabs[0].id);
  });

  it('closes the pane with the final tab', () => {
    state().openLink('https://a.example');
    state().closeTab(state().tabs[0].id);
    expect(state().tabs).toEqual([]);
    expect(state().activeId).toBeNull();
  });

  it('opens from outside React through openLinkInPane', () => {
    openLinkInPane('https://a.example');
    expect(urls()).toEqual(['https://a.example']);
  });
});

describe('linkPaneSide', () => {
  // Both defaulting to the right is what put one panel on top of the other.
  it('takes the edge the task detail panel is not on', () => {
    expect(linkPaneSide(true, 'right')).toBe('left');
    expect(linkPaneSide(true, 'left')).toBe('right');
  });

  it('defaults to the right when no task panel is open', () => {
    expect(linkPaneSide(false, 'right')).toBe('right');
    expect(linkPaneSide(false, 'left')).toBe('right');
  });
});

/**
 * Reported 2026-10-18 (#1068, then again as #1072): a strip of the page
 * showed between the link pane and the task detail panel. The panel's width
 * is not a constant — tiled it is 50vw, overlaid it is 75 / 66.7 / 50vw by
 * breakpoint — so the pane is sized from the panel's measured width.
 */
describe('linkPaneWidthVw', () => {
  it('runs up to a tiled panel', () => {
    expect(linkPaneWidthVw(TASK_DETAIL_SPLIT_WIDTH_VW)).toBe(100 - TASK_DETAIL_SPLIT_WIDTH_VW);
  });

  // The case #1068 missed: the default display mode is overlay, and there
  // the panel is wider than the tiled constant at most breakpoints.
  it.each([75, 66.7, 50])('runs up to an overlay panel of %svw', (panel) => {
    expect(linkPaneWidthVw(panel)).toBeCloseTo(100 - panel);
  });

  it('leaves no gap, whatever the panel measures', () => {
    for (const panel of [50, 66.7, 75]) {
      expect(linkPaneWidthVw(panel) + panel).toBeCloseTo(100);
    }
  });

  it('keeps its default width when no panel is there', () => {
    expect(linkPaneWidthVw(0)).toBe(LINK_VIEW_SPLIT_WIDTH_VW);
  });

  // A panel reporting the whole viewport would otherwise leave the pane
  // with no width at all, hiding the page it exists to show.
  it('never collapses to nothing', () => {
    expect(linkPaneWidthVw(100)).toBeGreaterThan(0);
    expect(linkPaneWidthVw(120)).toBeGreaterThan(0);
  });
});

/**
 * Ctrl+B hides and shows the pane, and must bring back what was open — so
 * closing the pane is not the same as closing the tabs (#1074).
 */
describe('showing and hiding the pane', () => {
  it('starts closed', () => {
    expect(state().isOpen).toBe(false);
  });

  it('opens when a link is opened, even from hidden', () => {
    state().openLink('https://a.example');
    expect(state().isOpen).toBe(true);
  });

  it('keeps the tabs when hidden, and brings them back', () => {
    state().openLink('https://a.example');
    state().openLink('https://b.example');
    const before = urls();
    const active = state().activeId;

    state().toggleOpen();
    expect(state().isOpen).toBe(false);
    expect(urls()).toEqual(before);

    state().toggleOpen();
    expect(state().isOpen).toBe(true);
    expect(urls()).toEqual(before);
    expect(state().activeId).toBe(active);
  });

  it('closes the pane along with every tab', () => {
    state().openLink('https://a.example');
    state().closeAll();
    expect(state().isOpen).toBe(false);
    expect(state().tabs).toEqual([]);
  });
});

describe('tab groups', () => {
  it('puts a tab in a group and takes it out again', () => {
    state().openLink('https://a.example');
    const id = state().tabs[0].id;
    state().setTabGroup(id, 'g1');
    expect(state().tabs[0].groupId).toBe('g1');
    state().setTabGroup(id, null);
    expect(state().tabs[0].groupId).toBeNull();
  });

  it('leaves other tabs alone', () => {
    state().openLink('https://a.example');
    state().openLink('https://b.example');
    state().setTabGroup(state().tabs[0].id, 'g1');
    expect(state().tabs[1].groupId).toBeUndefined();
  });
});

/**
 * The "+" button. It must not share openLink's de-duplication: pressing it
 * twice has to give two tabs even though both start at the same page
 * (#1074).
 */
describe('newTab', () => {
  it('opens at the default page', () => {
    state().newTab();
    expect(state().tabs).toHaveLength(1);
    expect(state().tabs[0].url).toBe(NEW_TAB_URL);
    expect(state().activeId).toBe(state().tabs[0].id);
  });

  it('adds a second one rather than focusing the first', () => {
    state().newTab();
    state().newTab();
    expect(state().tabs).toHaveLength(2);
    expect(state().tabs[0].id).not.toBe(state().tabs[1].id);
    expect(state().activeId).toBe(state().tabs[1].id);
  });

  // Contrast: openLink deliberately does focus an existing tab.
  it('differs from openLink, which still de-duplicates', () => {
    state().openLink('https://a.example');
    state().openLink('https://a.example');
    expect(state().tabs).toHaveLength(1);
  });

  it('shows the pane when it was hidden', () => {
    expect(state().isOpen).toBe(false);
    state().newTab();
    expect(state().isOpen).toBe(true);
  });
});

/**
 * A tab must describe the page it is on, not the one it was opened at:
 * "+" starts every tab at Google, and before this the heading and the
 * address bar both stayed there however far the user searched (#1078).
 */
describe('applyPageChange', () => {
  it('moves the tab to the URL the webview reported', () => {
    state().newTab();
    const id = state().tabs[0].id;
    state().applyPageChange(id, { url: 'https://www.google.com/search?q=rust' });
    expect(state().tabs[0].url).toBe('https://www.google.com/search?q=rust');
  });

  it('labels the tab with the page title', () => {
    state().newTab();
    const id = state().tabs[0].id;
    state().applyPageChange(id, { title: 'rust - Google 検索' });
    expect(state().tabs[0].title).toBe('rust - Google 検索');
  });

  it('drops a title that described the page just left', () => {
    state().newTab();
    const id = state().tabs[0].id;
    state().applyPageChange(id, { title: 'Google' });
    state().applyPageChange(id, { url: 'https://example.com/' });
    expect(state().tabs[0].title).toBeUndefined();
  });

  it('leaves the other tabs alone', () => {
    state().openLink('https://a.example');
    state().openLink('https://b.example');
    state().applyPageChange(state().tabs[0].id, { title: 'A' });
    expect(state().tabs[1].title).toBeUndefined();
  });

  // The webview is torn down asynchronously, so an event can land after
  // its tab has gone.
  it('ignores an event for a tab that is no longer open', () => {
    state().openLink('https://a.example');
    const id = state().tabs[0].id;
    state().closeTab(id);
    expect(() => state().applyPageChange(id, { url: 'https://b.example' })).not.toThrow();
    expect(state().tabs).toEqual([]);
  });
});

describe('setTabUrl', () => {
  it('clears the title of the page left behind', () => {
    state().newTab();
    const id = state().tabs[0].id;
    state().applyPageChange(id, { title: 'Google' });
    state().setTabUrl(id, 'https://example.com/');
    expect(state().tabs[0]).toMatchObject({ url: 'https://example.com/' });
    expect(state().tabs[0].title).toBeUndefined();
  });
});

/**
 * Closing must mean closing. Reported 2026-10-19: ✕ on the favourites view
 * fell back to the page, and ✕ on that page's last tab bounced straight
 * back into the favourites view — the pane could not be dismissed at all.
 */
describe('closing the pane', () => {
  it('closes the pane along with the final tab', () => {
    state().openLink('https://a.example');
    expect(state().isOpen).toBe(true);
    state().closeTab(state().tabs[0].id);
    expect(state().isOpen).toBe(false);
  });

  it('stays open while any tab is left', () => {
    state().openLink('https://a.example');
    state().openLink('https://b.example');
    state().closeTab(state().tabs[0].id);
    expect(state().isOpen).toBe(true);
  });

  it('comes back on the page, not the library, when tabs survived', () => {
    state().openLink('https://a.example');
    state().showLibrary();
    expect(state().view).toBe('library');

    state().setOpen(false);
    state().setOpen(true);
    expect(state().view).toBe('page');
  });
});

/**
 * Which face the pane shows. Ctrl+B with nothing open has no page to show,
 * so it opens on the library — that is where a saved page is picked (#1074).
 */
describe('the pane view', () => {
  it('starts on the page', () => {
    expect(state().view).toBe('page');
  });

  it('opens on the library when there is no tab to show', () => {
    state().toggleOpen();
    expect(state().isOpen).toBe(true);
    expect(state().view).toBe('library');
  });

  it('opens on the page when a tab is waiting', () => {
    state().openLink('https://a.example');
    state().toggleOpen();
    state().toggleOpen();
    expect(state().view).toBe('page');
  });

  it('switches to the library and back', () => {
    state().openLink('https://a.example');
    state().showLibrary();
    expect(state().view).toBe('library');
    state().showPage();
    expect(state().view).toBe('page');
  });

  // Opening a link from a note while the library is showing must show the
  // page that was asked for.
  it('returns to the page when a link is opened', () => {
    state().toggleOpen();
    expect(state().view).toBe('library');
    state().openLink('https://a.example');
    expect(state().view).toBe('page');
  });

  it('returns to the page when a new tab is opened', () => {
    state().toggleOpen();
    state().newTab();
    expect(state().view).toBe('page');
  });

  it('is back on the page after everything is closed', () => {
    state().openLink('https://a.example');
    state().showLibrary();
    state().closeAll();
    expect(state().view).toBe('page');
    expect(state().isOpen).toBe(false);
  });
});
