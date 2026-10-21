'use client';
/**
 * TabStripTab
 *
 * One tab in the strip: favicon, title, close button, and the right-click
 * menu that files it into a group — where a browser puts it.
 *
 * Owns no group state; it reports a choice and the strip applies it.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FolderPlus, Globe, Ungroup, X } from 'lucide-react';
import DropdownMenu, { type DropdownMenuItem } from '@/components/ui/dropdown/DropdownMenu';
import { faviconFor, tabLabel } from '../link-tab-meta';
import type { LinkTab } from '@/stores/link-view-store';
import type { LinkGroup } from '@/stores/link-library-store';

interface TabStripTabProps {
  tab: LinkTab;
  active: boolean;
  /** The group it is filed under, for the underline colour. / 所属グループ */
  group?: LinkGroup;
  /** Every group, offered in the menu. / 選択肢となる全グループ */
  groups: LinkGroup[];
  onActivate: () => void;
  onClose: () => void;
  /** File it under an existing group, or release it with null. / グループ変更 */
  onSetGroup: (groupId: string | null) => void;
  /** Start a new group holding just this tab. / 新規グループに入れる */
  onAddToNewGroup: () => void;
}

/**
 * @param props - The tab, whether it is showing, and what its menu can do
 */
export function TabStripTab({
  tab,
  active,
  group,
  groups,
  onActivate,
  onClose,
  onSetGroup,
  onAddToNewGroup,
}: TabStripTabProps) {
  const t = useTranslations('linkView');
  const [menuOpen, setMenuOpen] = useState(false);

  const label = tabLabel(tab);
  const icon = faviconFor(tab.url);

  const items: DropdownMenuItem[] = [
    {
      label: t('addToNewGroup'),
      icon: <FolderPlus className="h-4 w-4" />,
      onClick: onAddToNewGroup,
    },
    ...groups
      .filter((candidate) => candidate.id !== tab.groupId)
      .map((candidate) => ({
        label: candidate.name,
        icon: (
          <span
            className="block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: candidate.color }}
          />
        ),
        onClick: () => onSetGroup(candidate.id),
      })),
    ...(tab.groupId
      ? [
          {
            label: t('removeFromGroup'),
            icon: <Ungroup className="h-4 w-4" />,
            onClick: () => onSetGroup(null),
          },
        ]
      : []),
  ];

  return (
    <div
      className={`group relative flex min-w-0 max-w-44 items-center gap-1 rounded-t border-b-2 px-2 py-1 text-xs transition-colors ${
        active
          ? 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100'
          : 'text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/60'
      }`}
      // A grouped tab is marked in its group's colour, the same colour the
      // group's heading carries here and in the library.
      style={{ borderBottomColor: group?.color ?? (active ? '#6366f1' : 'transparent') }}
    >
      <button
        type="button"
        onClick={onActivate}
        // On the button rather than the wrapper: right-click belongs to
        // something the keyboard can reach too.
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        title={`${label}\n${tab.url}\n${t('rightClickForGroups')}`}
        className="flex min-w-0 flex-1 items-center gap-1 text-left"
      >
        {icon ? (
          // A 16px favicon from an external host: next/image would need
          // remote patterns and would proxy it, for no gain.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" width={14} height={14} className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Globe className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('closeTab', { host: label })}
        className="shrink-0 rounded p-0.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
      >
        <X className="h-3 w-3" />
      </button>

      <div className="absolute left-0 top-full">
        <DropdownMenu
          items={items}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          hideTrigger
          align="left"
          menuLabel={t('tabMenu', { host: label })}
          menuClassName="min-w-[170px] text-xs"
        />
      </div>
    </div>
  );
}
