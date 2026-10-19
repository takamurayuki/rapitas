'use client';
/**
 * TabGroupChip
 *
 * A tab group's heading: a coloured pill carrying the group's name, which
 * collapses and expands its tabs. Right-clicking it opens the group's own
 * actions, as a browser's does.
 *
 * Draws and reports; the stores own the group and the tabs.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Trash2, Ungroup, X } from 'lucide-react';
import DropdownMenu, { type DropdownMenuItem } from '@/components/ui/dropdown/DropdownMenu';
import { GroupEditor } from '../GroupEditor';
import type { LinkGroup } from '@/stores/link-library-store';

interface TabGroupChipProps {
  group: LinkGroup;
  /** How many tabs it holds, shown while collapsed. / 保持タブ数 */
  tabCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  /** Release the tabs, keeping them open. / グループを解除 */
  onUngroup: () => void;
  /** Close every tab in the group. / グループのタブを閉じる */
  onCloseGroup: () => void;
  /** Delete the group itself, from the library too. / グループを削除 */
  onDeleteGroup: () => void;
}

/**
 * @param props - The group, its size, and what its menu can do
 */
export function TabGroupChip({
  group,
  tabCount,
  collapsed,
  onToggleCollapsed,
  onRename,
  onRecolor,
  onUngroup,
  onCloseGroup,
  onDeleteGroup,
}: TabGroupChipProps) {
  const t = useTranslations('linkView');
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const items: DropdownMenuItem[] = [
    {
      label: t('editGroup'),
      icon: <Pencil className="h-4 w-4" />,
      onClick: () => setEditing(true),
    },
    { label: t('ungroup'), icon: <Ungroup className="h-4 w-4" />, onClick: onUngroup },
    { label: t('closeGroup'), icon: <X className="h-4 w-4" />, onClick: onCloseGroup },
    {
      label: t('deleteGroup'),
      icon: <Trash2 className="h-4 w-4" />,
      onClick: onDeleteGroup,
      variant: 'danger',
    },
  ];

  return (
    <div className="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={onToggleCollapsed}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        title={`${group.name}\n${collapsed ? t('expandGroup') : t('collapseGroup')}\n${t('rightClickForGroups')}`}
        aria-expanded={!collapsed}
        className="my-0.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-white transition-opacity hover:opacity-80"
        style={{ backgroundColor: group.color }}
      >
        <span className="max-w-24 truncate">{group.name}</span>
        {/* The count only matters while the tabs are hidden; when they are
            on screen it is just a number next to them. */}
        {collapsed && <span className="opacity-80">{tabCount}</span>}
      </button>

      <div className="absolute left-0 top-full">
        <DropdownMenu
          items={items}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          hideTrigger
          align="left"
          menuLabel={t('groupMenu', { name: group.name })}
          menuClassName="min-w-[170px] text-xs"
        />
      </div>

      {editing && (
        <div className="absolute left-0 top-full z-50 mt-1">
          <GroupEditor
            name={group.name}
            color={group.color}
            onRename={onRename}
            onRecolor={onRecolor}
            onDone={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}
