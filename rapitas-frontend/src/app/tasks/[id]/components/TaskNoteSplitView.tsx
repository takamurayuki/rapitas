/**
 * TaskNoteSplitView
 *
 * Full-page split view: the note editor beside the task detail, rendered
 * when the URL contains ?note=<noteId>.
 *
 * This replaces the task detail SLIDE PANEL, so it carries the panel's own
 * header: the 「タスク詳細」 heading, a way to put the task on the left, and
 * a close. Each arrived after being found missing — the heading in #1099,
 * the other two here — because a view that stands in for another has to
 * offer what that one offered.
 *
 * The side comes from the panel's persisted preference rather than a second
 * one of this view's own, so "task detail on the left" means the same thing
 * and stays the same wherever it is set.
 *
 * Which pane is white is deliberate and not a leftover: the note editor is a
 * document and paints white, while the task detail is cards on the app's
 * canvas colour — measured identical to the slide panel's own body. Only the
 * header bars were out of step, and they now match the panel's.
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, ChevronLeft, AlertCircle, ArrowLeftRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useNoteStore } from '@/stores/note-store';
import { useTaskDetailVisibilityStore } from '@/stores/task-detail-visibility-store';
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
  // The same key the slide panel's header uses, so the two read identically.
  const tPanel = useTranslations('task.taskSlidePanel');
  const router = useRouter();
  const dockSide = useTaskDetailVisibilityStore((s) => s.dockSide);
  const toggleDockSide = useTaskDetailVisibilityStore((s) => s.toggleDockSide);

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
      {/* Note pane. `order` rather than two branches of JSX: swapping sides
          must not remount the editor, which would drop an unsaved caret and
          the scroll position mid-edit. */}
      <div
        className={`flex w-1/2 flex-col overflow-hidden border-gray-200 dark:border-zinc-800 ${
          dockSide === 'right' ? 'order-1 border-r' : 'order-2 border-l'
        }`}
      >
        {/* Pane header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-indigo-dark-900">
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

      {/* Task pane. */}
      <div
        className={`flex min-h-0 w-1/2 flex-col ${dockSide === 'right' ? 'order-2' : 'order-1'}`}
      >
        {/* Pane header. This view replaces the task detail SLIDE PANEL, which
            carries a 「タスク詳細」 bar — leaving it out gave the right half no
            heading at all while the left half had one, so opening a note read
            as the task detail having lost its title. */}
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-indigo-dark-900">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {tPanel('title')}
          </h2>
          <div className="flex-1" />
          <button
            onClick={toggleDockSide}
            title={dockSide === 'right' ? tPanel('dockLeft') : tPanel('dockRight')}
            aria-label={tPanel('swapDockSideAria')}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            onClick={handleClose}
            title={tPanel('closeTooltip')}
            aria-label={tPanel('closeAria')}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* The scroll moves here so the header above stays put. The quick-nav
            finds its scroller with closest(), so the marker has to be on
            whichever element actually scrolls — the pane root no longer does. */}
        <div data-task-scroll-container className="min-h-0 flex-1 overflow-y-auto">
          <TaskDetailClient />
        </div>
      </div>
    </div>
  );
}
