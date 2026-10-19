/**
 * link-library-store.test
 *
 * Saved pages are the part that outlives the session, so the cases that
 * matter are the ones that could lose them: saving the same page twice, and
 * deleting a group they are filed under.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useLinkLibraryStore,
  groupFavourites,
  type LinkFavourite,
  type LinkGroup,
} from '../link-library-store';

const state = () => useLinkLibraryStore.getState();
const save = (url: string, groupId: string | null = null) =>
  state().addFavourite({ url, title: url, favicon: '', groupId });

describe('link-library-store', () => {
  beforeEach(() => {
    useLinkLibraryStore.setState({ groups: [], favourites: [] });
  });

  it('starts empty', () => {
    expect(state().groups).toEqual([]);
    expect(state().favourites).toEqual([]);
  });

  it('saves a page and reports it as saved', () => {
    save('https://a.example');
    expect(state().favourites).toHaveLength(1);
    expect(state().isFavourite('https://a.example')).toBe(true);
    expect(state().isFavourite('https://b.example')).toBe(false);
  });

  // Saving again should refresh the entry, not add a second one — the title
  // and icon may have resolved since the first save.
  it('updates rather than duplicating when the same URL is saved again', () => {
    save('https://a.example');
    state().addFavourite({
      url: 'https://a.example',
      title: 'Resolved',
      favicon: 'icon.png',
      groupId: null,
    });
    expect(state().favourites).toHaveLength(1);
    expect(state().favourites[0].title).toBe('Resolved');
  });

  it('gives each group a colour from the palette', () => {
    state().addGroup('One');
    state().addGroup('Two');
    const [a, b] = state().groups;
    expect(a.color).toBeTruthy();
    expect(a.color).not.toBe(b.color);
  });

  it('names an unnamed group rather than leaving it blank', () => {
    state().addGroup('   ');
    expect(state().groups[0].name).not.toBe('');
  });

  // The pages are the valuable part; a group is an arrangement of them.
  it('keeps the pages when their group is deleted', () => {
    const id = state().addGroup('Design');
    save('https://a.example', id);
    state().removeGroup(id);
    expect(state().groups).toHaveLength(0);
    expect(state().favourites).toHaveLength(1);
    expect(state().favourites[0].groupId).toBeNull();
  });

  it('moves a page between groups', () => {
    const a = state().addGroup('A');
    const b = state().addGroup('B');
    save('https://x.example', a);
    state().setFavouriteGroup(state().favourites[0].id, b);
    expect(state().favourites[0].groupId).toBe(b);
    state().setFavouriteGroup(state().favourites[0].id, null);
    expect(state().favourites[0].groupId).toBeNull();
  });

  it('removes one page without touching the others', () => {
    save('https://a.example');
    save('https://b.example');
    state().removeFavourite(state().favourites[0].id);
    expect(state().favourites.map((f) => f.url)).toEqual(['https://b.example']);
  });
});

describe('groupFavourites', () => {
  const group = (id: string, name: string): LinkGroup => ({ id, name, color: '#000' });
  const fav = (id: string, groupId: string | null): LinkFavourite => ({
    id,
    url: `https://${id}.example`,
    title: id,
    favicon: '',
    groupId,
  });

  it('lists each group with its own pages', () => {
    const sections = groupFavourites(
      [group('g1', 'A'), group('g2', 'B')],
      [fav('f1', 'g1'), fav('f2', 'g2'), fav('f3', 'g1')],
    );
    expect(sections.map((s) => s.group?.name)).toEqual(['A', 'B']);
    expect(sections[0].items.map((i) => i.id)).toEqual(['f1', 'f3']);
  });

  // A group made before anything is filed into it should not vanish while
  // the user is about to fill it.
  it('keeps an empty group', () => {
    const sections = groupFavourites([group('g1', 'Empty')], []);
    expect(sections).toHaveLength(1);
    expect(sections[0].items).toEqual([]);
  });

  it('puts ungrouped pages in a section of their own, last', () => {
    const sections = groupFavourites([group('g1', 'A')], [fav('f1', 'g1'), fav('f2', null)]);
    expect(sections[sections.length - 1].group).toBeNull();
    expect(sections[sections.length - 1].items.map((i) => i.id)).toEqual(['f2']);
  });

  // A group can be deleted while a stale id lingers on a page; it must still
  // be reachable rather than disappearing from every section.
  it('treats a page pointing at a missing group as ungrouped', () => {
    const sections = groupFavourites([group('g1', 'A')], [fav('f1', 'gone')]);
    expect(sections[sections.length - 1].group).toBeNull();
    expect(sections[sections.length - 1].items.map((i) => i.id)).toEqual(['f1']);
  });

  it('adds no loose section when everything is filed', () => {
    const sections = groupFavourites([group('g1', 'A')], [fav('f1', 'g1')]);
    expect(sections.every((s) => s.group !== null)).toBe(true);
  });
});

/**
 * A group is shared between the saved pages and the tab strip, so its
 * colour is part of telling one group from another at a glance.
 */
describe('setGroupColor', () => {
  beforeEach(() => {
    useLinkLibraryStore.setState({ groups: [], favourites: [] });
  });

  it('changes the colour of one group', () => {
    const id = state().addGroup('Design');
    state().setGroupColor(id, '#ef4444');
    expect(state().groups[0].color).toBe('#ef4444');
  });

  it('leaves the other groups alone', () => {
    const first = state().addGroup('Design');
    state().addGroup('Docs');
    const other = state().groups[1].color;
    state().setGroupColor(first, '#ef4444');
    expect(state().groups[1].color).toBe(other);
  });

  it('ignores a group that is not there', () => {
    state().addGroup('Design');
    expect(() => state().setGroupColor('gone', '#ef4444')).not.toThrow();
    expect(state().groups).toHaveLength(1);
  });

  it('gives consecutive groups different colours to start with', () => {
    state().addGroup('A');
    state().addGroup('B');
    expect(state().groups[0].color).not.toBe(state().groups[1].color);
  });
});
