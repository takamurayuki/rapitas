'use client';
/**
 * TabStrip
 *
 * The row of tabs, with browser-style groups: members drawn together under
 * a coloured heading that collapses them.
 *
 * It takes which tab is showing from the pane, and reads the groups from
 * the stores — a group is shared with the saved-pages library, so threading
 * it through the pane would only pass it along untouched.
 */
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { useLinkViewStore, type LinkTab } from '@/stores/link-view-store';
import { useLinkLibraryStore } from '@/stores/link-library-store';
import { addTabToNewGroup, deleteGroupEverywhere } from '../group-actions';
import { TabGroupChip } from './TabGroupChip';
import { TabStripTab } from './TabStripTab';
import { arrangeTabs } from './tab-arrangement';

interface TabStripProps {
  tabs: LinkTab[];
  activeId: string;
  onActivate: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
}

/**
 * @param props - The open tabs, which is showing, and the pane's tab actions
 */
export function TabStrip({ tabs, activeId, onActivate, onCloseTab, onNewTab }: TabStripProps) {
  const t = useTranslations('linkView');

  const groups = useLinkLibraryStore((s) => s.groups);
  const renameGroup = useLinkLibraryStore((s) => s.renameGroup);
  const setGroupColor = useLinkLibraryStore((s) => s.setGroupColor);

  const collapsedGroupIds = useLinkViewStore((s) => s.collapsedGroupIds);
  const setTabGroup = useLinkViewStore((s) => s.setTabGroup);
  const toggleGroupCollapsed = useLinkViewStore((s) => s.toggleGroupCollapsed);
  const ungroupTabs = useLinkViewStore((s) => s.ungroupTabs);
  const closeGroup = useLinkViewStore((s) => s.closeGroup);

  const rows = arrangeTabs(tabs, groups);

  const renderTab = (tab: LinkTab) => (
    <TabStripTab
      key={tab.id}
      tab={tab}
      active={tab.id === activeId}
      group={groups.find((g) => g.id === tab.groupId)}
      groups={groups}
      onActivate={() => onActivate(tab.id)}
      onClose={() => onCloseTab(tab.id)}
      onSetGroup={(groupId) => setTabGroup(tab.id, groupId)}
      onAddToNewGroup={() => addTabToNewGroup(tab.id, t('newGroupName'))}
    />
  );

  return (
    <div className="flex shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-zinc-200 px-1 pt-1 dark:border-zinc-700">
      {rows.map((row) =>
        row.kind === 'tab' ? (
          renderTab(row.tab)
        ) : (
          <div key={row.group.id} className="flex items-stretch gap-0.5">
            <TabGroupChip
              group={row.group}
              tabCount={row.tabs.length}
              collapsed={collapsedGroupIds.includes(row.group.id)}
              onToggleCollapsed={() => toggleGroupCollapsed(row.group.id)}
              onRename={(name) => renameGroup(row.group.id, name)}
              onRecolor={(color) => setGroupColor(row.group.id, color)}
              onUngroup={() => ungroupTabs(row.group.id)}
              onCloseGroup={() => closeGroup(row.group.id)}
              onDeleteGroup={() => deleteGroupEverywhere(row.group.id)}
            />
            {!collapsedGroupIds.includes(row.group.id) && row.tabs.map(renderTab)}
          </div>
        ),
      )}
      <button
        type="button"
        onClick={onNewTab}
        title={t('newTab')}
        aria-label={t('newTab')}
        className="my-0.5 shrink-0 rounded px-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
