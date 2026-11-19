'use client';
/**
 * NoteSidebarItem
 *
 * One note row of the /notes sidebar tree: select on click or Enter/Space,
 * delete from the hover button. Split out of NoteSidebar.tsx; the tree and
 * its expansion stay there.
 */
import { useTranslations } from 'next-intl';
import { NotebookPen, Trash2 } from 'lucide-react';
import type { Note } from '@/stores/note-store';

/**
 * A note row.
 *
 * @param props.note - The note / ノート
 * @param props.isActive - Whether it is the open note / 開いているノートか
 * @param props.onSelect - Open it / 開く
 * @param props.onDelete - Ask to delete it / 削除を確認する
 */
export default function NoteItem({
  note,
  isActive,
  onSelect,
  onDelete,
}: {
  note: Note;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('notes');
  const displayTitle = note.title.includes(' > ')
    ? (note.title.split(' > ').pop() ?? note.title)
    : note.title || t('common.untitled');

  return (
    <div
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group flex items-center gap-2 pl-10 pr-2 py-1.5 rounded-md cursor-pointer transition-colors ${
        isActive
          ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
          : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700/50'
      }`}
    >
      <NotebookPen className="w-3.5 h-3.5 shrink-0 text-indigo-400 dark:text-indigo-500" />
      <span className="flex-1 text-xs truncate">{displayTitle}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-zinc-400 hover:text-red-500 transition-opacity shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
