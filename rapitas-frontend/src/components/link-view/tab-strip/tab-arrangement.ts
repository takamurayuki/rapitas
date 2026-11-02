/**
 * tab-arrangement
 *
 * Turns the flat tab list into the rows the strip draws: a group's members
 * under one heading, everything else on its own.
 *
 * Arranging at draw time rather than reordering the stored list is the
 * whole trick. A browser physically moves a tab when you file it, which
 * means grouping has a side effect on an order the user set deliberately.
 * Here the stored order is left exactly as it was and only the drawing
 * gathers the members, so ungrouping puts every tab back where it started.
 */
import type { LinkTab } from '@/stores/link-view-store';
import type { LinkGroup } from '@/stores/link-library-store';

/** One thing the strip draws: a lone tab, or a group with its members. */
export type TabRow =
  | { kind: 'tab'; tab: LinkTab }
  | { kind: 'group'; group: LinkGroup; tabs: LinkTab[] };

/**
 * Every tab filed under a group, in strip order.
 *
 * @param tabs - All open tabs / 開いているタブ
 * @param groupId - The group to collect / 対象グループ
 * @returns Its members, possibly none / 所属タブ（無いこともある）
 */
export function tabsInGroup(tabs: LinkTab[], groupId: string): LinkTab[] {
  return tabs.filter((tab) => tab.groupId === groupId);
}

/**
 * The rows the strip draws, in order.
 *
 * A group takes the place of its first member and collects the rest; the
 * tabs between them close up. A tab whose group has been deleted from the
 * library still draws — as an ungrouped tab, not as nothing.
 *
 * @param tabs - All open tabs, in the order they were opened / 開いているタブ
 * @param groups - The groups that currently exist / 現存するグループ
 * @returns Rows to draw, left to right / 左から順に描画する行
 */
export function arrangeTabs(tabs: LinkTab[], groups: LinkGroup[]): TabRow[] {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const placed = new Set<string>();
  const rows: TabRow[] = [];

  for (const tab of tabs) {
    const group = tab.groupId ? byId.get(tab.groupId) : undefined;
    if (!group) {
      rows.push({ kind: 'tab', tab });
      continue;
    }
    if (placed.has(group.id)) continue;
    placed.add(group.id);
    rows.push({ kind: 'group', group, tabs: tabsInGroup(tabs, group.id) });
  }

  return rows;
}
