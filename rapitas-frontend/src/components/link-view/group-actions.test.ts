/**
 * group-actions.test
 *
 * A group lives in two stores at once, so deleting it has to reach both.
 * These pin that, and pin that nothing is lost in the process — the group
 * is an arrangement of pages and tabs, not a container for them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useLinkViewStore } from '@/stores/link-view-store';
import { useLinkLibraryStore } from '@/stores/link-library-store';
import { addTabToNewGroup, deleteGroupEverywhere } from './group-actions';

const view = () => useLinkViewStore.getState();
const library = () => useLinkLibraryStore.getState();

beforeEach(() => {
  useLinkViewStore.setState({
    tabs: [],
    activeId: null,
    isOpen: false,
    view: 'page',
    collapsedGroupIds: [],
  });
  useLinkLibraryStore.setState({ groups: [], favourites: [] });
});

/** A group holding one open tab and one saved page. */
function aGroupWithBoth() {
  const groupId = library().addGroup('Design');
  view().openLink('https://a.example');
  view().setTabGroup(view().tabs[0].id, groupId);
  library().addFavourite({ url: 'https://saved.example', title: 'Saved', favicon: '', groupId });
  return groupId;
}

describe('deleteGroupEverywhere', () => {
  it('removes the group from the library', () => {
    deleteGroupEverywhere(aGroupWithBoth());
    expect(library().groups).toEqual([]);
  });

  // The defect this exists to prevent: the library forgets the group and
  // the tabs keep pointing at an id nothing resolves.
  it('releases the tabs that were filed under it', () => {
    deleteGroupEverywhere(aGroupWithBoth());
    expect(view().tabs).toHaveLength(1);
    expect(view().tabs[0].groupId).toBeNull();
  });

  it('keeps the saved pages, ungrouped', () => {
    deleteGroupEverywhere(aGroupWithBoth());
    expect(library().favourites).toHaveLength(1);
    expect(library().favourites[0].groupId).toBeNull();
  });

  it('closes no tabs', () => {
    const before = view().tabs.length;
    deleteGroupEverywhere(aGroupWithBoth());
    expect(view().tabs.length).toBeGreaterThan(before);
  });

  it('forgets that the group was collapsed', () => {
    const groupId = aGroupWithBoth();
    view().toggleGroupCollapsed(groupId);
    deleteGroupEverywhere(groupId);
    expect(view().collapsedGroupIds).toEqual([]);
  });

  it('leaves another group alone', () => {
    const groupId = aGroupWithBoth();
    const other = library().addGroup('Docs');
    deleteGroupEverywhere(groupId);
    expect(library().groups.map((g) => g.id)).toEqual([other]);
  });

  it('does nothing for a group that is not there', () => {
    aGroupWithBoth();
    expect(() => deleteGroupEverywhere('gone')).not.toThrow();
    expect(library().groups).toHaveLength(1);
  });
});

describe('addTabToNewGroup', () => {
  it('creates the group and files the tab under it', () => {
    view().openLink('https://a.example');
    const id = addTabToNewGroup(view().tabs[0].id, 'New group');
    expect(library().groups.map((g) => g.id)).toEqual([id]);
    expect(view().tabs[0].groupId).toBe(id);
  });

  it('gives the group the name it was asked for', () => {
    view().openLink('https://a.example');
    addTabToNewGroup(view().tabs[0].id, 'Reading');
    expect(library().groups[0].name).toBe('Reading');
  });

  it('makes a separate group each time', () => {
    view().openLink('https://a.example');
    view().openLink('https://b.example');
    const first = addTabToNewGroup(view().tabs[0].id, 'A');
    const second = addTabToNewGroup(view().tabs[1].id, 'B');
    expect(first).not.toBe(second);
    expect(library().groups).toHaveLength(2);
  });
});
