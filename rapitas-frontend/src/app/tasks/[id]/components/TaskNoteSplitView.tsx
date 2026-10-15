/**
 * TaskNoteSplitView
 *
 * Full-page split view: existing NoteEditor on the left, task detail on the right.
 * Rendered when the URL contains ?note=<noteId>.
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, ChevronLeft, AlertCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useNoteStore } from '@/stores/note-store';
import NoteEditor from '@/components/note/NoteEditor';
import TaskDetailClient from '../TaskDetailClient';

interface Props {
  taskId: number;
  /** String ID from the localStorage note store (Date.now().toString()). */
  noteId: string;
}

/**
 * Renders a two-pane layout with the Note・AI editor on the left and the
 * task detail on the right.
 *
 * @param props.taskId - ID of the parent task (used for the back link).
 * @param props.noteId - String ID of the note to open.
 */
export function TaskNoteSplitView({ taskId: _taskId, noteId }: Props) {
  const t = useTranslations('task');
  const tc = useTranslations('common');
  const router = useRouter();

  // NOTE: Prevent the page body from scrolling while the split view is active.
  // The right pane owns the scroll container; body scroll would create a
  // second outer scrollbar alongside the pane's overflow-y-auto scrollbar.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  const note = useNoteStore((s) => s.notes.find((n) => n.id === noteId));

  const handleClose = () => {
    // NOTE: router.back() restores the previous context:
    // - page mode (/tasks/:id?showHeader=true) → returns to the page with header
    // - slide panel (home/kanban) → returns to the originating list page
    router.back();
  };

  return (
    // NOTE: h-[calc(100vh-4rem)] subtracts the sticky header height (h-16 = 4rem)
    // so the split view fits exactly in the space below the header with no overflow.
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden bg-white dark:bg-zinc-950">
      {/* Left pane: note editor */}
      <div className="flex w-1/2 flex-col overflow-hidden border-r border-gray-200 dark:border-zinc-800">
        {/* Pane header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
          <button
            onClick={handleClose}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t('noteSplitView.backToTask')}
          </button>
          <div className="flex-1" />
          <button
            onClick={handleClose}
            aria-label={tc('close')}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Note editor fills remaining height */}
        <div className="min-h-0 flex-1 overflow-hidden bg-white dark:bg-zinc-950">
          {note ? (
            <NoteEditor note={note} />
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-400 dark:text-zinc-500">
              <AlertCircle className="h-4 w-4" />
              {t('noteSplitView.noteNotFound')}
            </div>
          )}
        </div>
      </div>

      {/* Right pane: task detail */}
      <div className="flex min-h-0 w-1/2 flex-col overflow-y-auto">
        <TaskDetailClient />
      </div>
    </div>
  );
}
