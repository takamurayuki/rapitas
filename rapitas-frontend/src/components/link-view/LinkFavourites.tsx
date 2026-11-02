'use client';
/**
 * LinkFavourites
 *
 * Saved pages as icon-and-title tiles under their group's heading, rather
 * than a list of URLs — the point is that a glance tells you what each one
 * is, which a bare link does not.
 *
 * Draws only; `link-library-store` owns the data and the host opens what is
 * clicked.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bookmark, FolderPlus, Globe, Pencil, Trash2, X } from 'lucide-react';
import DropdownMenu, { type DropdownMenuItem } from '@/components/ui/dropdown/DropdownMenu';
import { deleteGroupEverywhere } from './group-actions';
import { GroupEditor } from './GroupEditor';
import {
  groupFavourites,
  useLinkLibraryStore,
  type LinkFavourite,
} from '@/stores/link-library-store';
import { hostOf } from './link-tab-meta';

interface LinkFavouritesProps {
  /** Open a saved page in a tab. / タブで開く */
  onOpen: (favourite: LinkFavourite) => void;
  /** Close the favourites view. / 閉じる */
  onClose: () => void;
}

/**
 * @param props - Open and close callbacks / 開く・閉じる操作
 */
export function LinkFavourites({ onOpen, onClose }: LinkFavouritesProps) {
  const t = useTranslations('linkView');
  const groups = useLinkLibraryStore((s) => s.groups);
  const favourites = useLinkLibraryStore((s) => s.favourites);
  const addGroup = useLinkLibraryStore((s) => s.addGroup);
  const renameGroup = useLinkLibraryStore((s) => s.renameGroup);
  const setGroupColor = useLinkLibraryStore((s) => s.setGroupColor);
  const removeFavourite = useLinkLibraryStore((s) => s.removeFavourite);
  const setFavouriteGroup = useLinkLibraryStore((s) => s.setFavouriteGroup);

  const [newGroup, setNewGroup] = useState('');
  /** The group whose name-and-colour panel is open, if any. */
  const [editingId, setEditingId] = useState<string | null>(null);

  /** Delete a group, closing its editor first if that is what is open. */
  const deleteGroup = (id: string) => {
    setEditingId((open) => (open === id ? null : open));
    deleteGroupEverywhere(id);
  };

  /** The group heading's menu: the same actions the tab chip offers. */
  const groupMenu = (id: string): DropdownMenuItem[] => [
    {
      label: t('editGroup'),
      icon: <Pencil className="h-4 w-4" />,
      onClick: () => setEditingId(id),
    },
    {
      label: t('deleteGroup'),
      icon: <Trash2 className="h-4 w-4" />,
      onClick: () => deleteGroup(id),
      variant: 'danger',
    },
  ];
  const sections = groupFavourites(groups, favourites);

  return (
    <div className="flex h-full min-w-0 flex-col bg-white dark:bg-zinc-900">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-700">
        <Bookmark className="h-4 w-4 shrink-0 text-indigo-500" />
        <span className="flex-1 text-xs font-medium text-zinc-700 dark:text-zinc-200">
          {t('favourites')}
        </span>
        <button
          onClick={onClose}
          title={t('close')}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-zinc-200 px-3 py-1.5 dark:border-zinc-700">
        <FolderPlus className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <input
          value={newGroup}
          onChange={(e) => setNewGroup(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !newGroup.trim()) return;
            addGroup(newGroup);
            setNewGroup('');
          }}
          placeholder={t('newGroupPlaceholder')}
          aria-label={t('newGroupPlaceholder')}
          className="min-w-0 flex-1 rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 outline-none focus:ring-1 focus:ring-indigo-400 dark:bg-zinc-800 dark:text-zinc-200"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {favourites.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-zinc-400">{t('noFavourites')}</p>
        )}

        {sections.map(({ group, items }) => (
          <section key={group?.id ?? '__loose'} className="mb-3">
            <div className="relative mb-1 flex items-center gap-1.5 px-1">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: group?.color ?? '#a1a1aa' }}
              />
              <h3 className="truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                {group?.name ?? t('ungrouped')}
              </h3>
              <span className="flex-1 text-[10px] text-zinc-400">{items.length}</span>
              {/* The loose section is not a group, so it has nothing to
                  rename, recolour or delete. */}
              {group && (
                <DropdownMenu
                  items={groupMenu(group.id)}
                  variant="ghost"
                  triggerClassName="!p-0.5 !rounded"
                  triggerLabel={t('groupMenu', { name: group.name })}
                  menuLabel={t('groupMenu', { name: group.name })}
                  menuClassName="min-w-[170px] text-xs"
                />
              )}
              {group && editingId === group.id && (
                <div className="absolute right-0 top-full z-50 mt-1">
                  <GroupEditor
                    name={group.name}
                    color={group.color}
                    onRename={(name) => renameGroup(group.id, name)}
                    onRecolor={(color) => setGroupColor(group.id, color)}
                    onDone={() => setEditingId(null)}
                  />
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <p className="px-2 py-1 text-[11px] text-zinc-400">{t('groupEmpty')}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-1">
                {items.map((fav) => (
                  <li key={fav.id} className="group relative">
                    <button
                      onClick={() => onOpen(fav)}
                      title={fav.url}
                      className="flex w-full min-w-0 items-center gap-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-indigo-700 dark:hover:bg-zinc-700"
                    >
                      {fav.favicon ? (
                        // A 16px favicon from an external host: next/image would
                        // need remote patterns and would proxy it, for no gain.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={fav.favicon}
                          alt=""
                          width={16}
                          height={16}
                          className="h-4 w-4 shrink-0 rounded-sm"
                        />
                      ) : (
                        <Globe className="h-4 w-4 shrink-0 text-zinc-400" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-zinc-700 dark:text-zinc-200">
                          {fav.title || hostOf(fav.url)}
                        </span>
                        <span className="block truncate text-[10px] text-zinc-400">
                          {hostOf(fav.url)}
                        </span>
                      </span>
                    </button>

                    <div className="absolute right-1 top-1 hidden items-center gap-0.5 group-hover:flex">
                      <select
                        value={fav.groupId ?? ''}
                        onChange={(e) => setFavouriteGroup(fav.id, e.target.value || null)}
                        aria-label={t('moveToGroup')}
                        className="max-w-20 rounded border border-zinc-300 bg-white text-[10px] text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-300"
                      >
                        <option value="">{t('ungrouped')}</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeFavourite(fav.id)}
                        aria-label={t('removeFavourite')}
                        className="rounded bg-white p-0.5 text-zinc-400 hover:text-rose-600 dark:bg-zinc-900"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
