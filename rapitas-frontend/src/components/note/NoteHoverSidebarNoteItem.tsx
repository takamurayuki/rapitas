/**
 * NoteHoverSidebarNoteItem
 *
 * Single note row (title/snippet/date + delete button) rendered at every
 * level of NoteHoverSidebar's tree. Extracted from the sidebar component to
 * keep it under the size limit; markup and behavior are unchanged.
 */
'use client';
import { type useTranslations } from 'next-intl';
import { Calendar, NotebookPen, Trash2 } from 'lucide-react';
import type { Note } from '@/stores/note-store';

export interface NoteHoverSidebarNoteItemProps {
  note: Note;
  isActive: boolean;
  onSelect: () => void;
  onDeleteRequest: () => void;
  formatDate: (date: Date) => string;
  /** `useTranslations('notes')` from the parent — kept as a prop to avoid a duplicate hook call. */
  t: ReturnType<typeof useTranslations<'notes'>>;
}

/** Single note row rendered at every level of the note tree. */
export default function NoteHoverSidebarNoteItem({
  note,
  isActive,
  onSelect,
  onDeleteRequest,
  formatDate,
  t,
}: NoteHoverSidebarNoteItemProps) {
  return (
    <div
      onClick={onSelect}
      className={`group px-3 py-2 rounded-lg cursor-pointer transition-all ${
        isActive
          ? 'bg-indigo-50 dark:bg-indigo-900/20 border-l-2 border-indigo-500'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <NotebookPen className="w-3 h-3 shrink-0 text-indigo-400" />
            <h4 className="font-medium text-xs truncate text-zinc-900 dark:text-zinc-100">
              {note.title.includes(' > ')
                ? (note.title.split(' > ').pop() ?? note.title)
                : note.title || t('common.untitled')}
            </h4>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-1">
            {note.content.replace(/<[^>]*>/g, '') || t('hoverSidebar.noContent')}
          </p>
          <div className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-500">
            <Calendar className="w-2.5 h-2.5" />
            {formatDate(note.updatedAt)}
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDeleteRequest();
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-zinc-400 hover:text-red-500 transition-all shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
