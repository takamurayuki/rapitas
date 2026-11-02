/**
 * tab-arrangement.test
 *
 * A group is only legible if its tabs sit together under one heading, the
 * way a browser draws them. These pin where each tab lands.
 */
import { describe, it, expect } from 'vitest';
import { arrangeTabs, tabsInGroup } from './tab-arrangement';
import type { LinkTab } from '@/stores/link-view-store';
import type { LinkGroup } from '@/stores/link-library-store';

const GROUPS: LinkGroup[] = [
  { id: 'g1', name: 'Design', color: '#6366f1' },
  { id: 'g2', name: 'Docs', color: '#10b981' },
];

const tab = (id: string, groupId?: string | null): LinkTab => ({
  id,
  url: `https://${id}.example`,
  groupId,
});

describe('arrangeTabs', () => {
  it('gives an ungrouped tab a row of its own, in order', () => {
    expect(arrangeTabs([tab('a'), tab('b')], GROUPS)).toEqual([
      { kind: 'tab', tab: tab('a') },
      { kind: 'tab', tab: tab('b') },
    ]);
  });

  // The point of a group: its members are drawn together even when they
  // were opened at different times.
  it('gathers a group at the position of its first member', () => {
    const rows = arrangeTabs([tab('a', 'g1'), tab('b'), tab('c', 'g1')], GROUPS);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      kind: 'group',
      group: GROUPS[0],
      tabs: [tab('a', 'g1'), tab('c', 'g1')],
    });
    expect(rows[1]).toEqual({ kind: 'tab', tab: tab('b') });
  });

  it('leaves ungrouped tabs before the group where they were', () => {
    const rows = arrangeTabs([tab('a'), tab('b', 'g1'), tab('c')], GROUPS);
    expect(rows.map((r) => (r.kind === 'tab' ? r.tab.id : r.group.id))).toEqual(['a', 'g1', 'c']);
  });

  it('keeps two groups apart, each at its own first member', () => {
    const rows = arrangeTabs([tab('a', 'g2'), tab('b', 'g1'), tab('c', 'g2')], GROUPS);
    expect(rows.map((r) => (r.kind === 'tab' ? r.tab.id : r.group.id))).toEqual(['g2', 'g1']);
    expect(rows[0]).toMatchObject({ tabs: [tab('a', 'g2'), tab('c', 'g2')] });
  });

  // A group deleted from the library leaves its id behind on the tabs. The
  // strip must still draw them rather than dropping them off screen.
  it('draws a tab whose group no longer exists as an ungrouped tab', () => {
    const rows = arrangeTabs([tab('a', 'gone'), tab('b')], GROUPS);
    expect(rows).toEqual([
      { kind: 'tab', tab: tab('a', 'gone') },
      { kind: 'tab', tab: tab('b') },
    ]);
  });

  it('emits no row for a group nothing is filed under', () => {
    const rows = arrangeTabs([tab('a')], GROUPS);
    expect(rows.some((r) => r.kind === 'group')).toBe(false);
  });

  it('handles an empty strip', () => {
    expect(arrangeTabs([], GROUPS)).toEqual([]);
  });

  it('treats a null groupId as ungrouped', () => {
    expect(arrangeTabs([tab('a', null)], GROUPS)).toEqual([{ kind: 'tab', tab: tab('a', null) }]);
  });
});

describe('tabsInGroup', () => {
  it('finds every member, in strip order', () => {
    const tabs = [tab('a', 'g1'), tab('b'), tab('c', 'g1')];
    expect(tabsInGroup(tabs, 'g1').map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('finds none for a group nothing belongs to', () => {
    expect(tabsInGroup([tab('a')], 'g1')).toEqual([]);
  });
});
