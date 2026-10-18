/**
 * link-view-store.test
 *
 * Tabs are only useful if opening the same link twice does not stack
 * duplicates and closing one lands somewhere sensible — both are what makes
 * the pane feel like a browser rather than a list that grows.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useLinkViewStore, openLinkInPane, LINK_VIEW_SPLIT_WIDTH_VW } from '../link-view-store';
import { linkPaneSide, linkPaneWidthVw } from '@/components/link-view/LinkViewHost';
import { TASK_DETAIL_SPLIT_WIDTH_VW } from '../task-detail-visibility-store';

const state = () => useLinkViewStore.getState();
const urls = () => state().tabs.map((t) => t.url);

describe('link-view-store', () => {
  beforeEach(() => {
    useLinkViewStore.setState({ tabs: [], activeId: null });
  });

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
 * Reported 2026-10-18 (#1068): a strip of the page showed between the link
 * pane and the task detail panel. The pane kept its default width instead
 * of running up to the panel beside it.
 */
describe('linkPaneWidthVw', () => {
  it('runs up to the task panel when that panel tiles beside the page', () => {
    // 50vw task panel + 50vw pane leaves nothing showing between them.
    expect(linkPaneWidthVw(true)).toBe(100 - TASK_DETAIL_SPLIT_WIDTH_VW);
  });

  it('keeps its default width when no task panel is tiled', () => {
    expect(linkPaneWidthVw(false)).toBe(LINK_VIEW_SPLIT_WIDTH_VW);
  });

  it('never leaves a gap', () => {
    expect(linkPaneWidthVw(true) + TASK_DETAIL_SPLIT_WIDTH_VW).toBe(100);
  });
});
