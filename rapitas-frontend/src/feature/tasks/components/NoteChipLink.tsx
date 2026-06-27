/**
 * NoteChipLink
 *
 * Confluence-style inline note link chip rendered inside task descriptions.
 * Reads the note title from the local store so it stays current after renames.
 *
 * Behaviour depends on context:
 * - Inside TaskSlidePanel: opens the note in the existing modal overlay so the panel stays open.
 * - Elsewhere: navigates to the split view (/tasks/:taskId?showHeader=true&note=:noteId).
 *
 * taskId comes from the link itself (/rapitas-note/{taskId}/{noteId} format),
 * so this chip works correctly when rendered on any page, not just the task detail.
 */
'use client';

import { useParams, useRouter } from 'next/navigation';
import { NotebookPen } from 'lucide-react';
import { useNoteStore } from '@/stores/note-store';
import { useIsInSlidePanel } from '@/feature/tasks/contexts/SlidePanelContext';

interface Props {
  /** String ID from the localStorage note store (Date.now().toString()). */
  noteId: string;
  /**
   * Task ID encoded in the link URL (/rapitas-note/{taskId}/{noteId}).
   * When present, navigation works from any page.
   * Falls back to useParams().id for old rapitas-note:// format links.
   */
  taskId?: string;
  /** Title from the markdown link text, used as fallback when note is not found. */
  fallbackTitle: string;
}

/**
 * Renders a clickable note chip, resolving the live title from the note store.
 *
 * @param props.noteId - ID of the note in the local store.
 * @param props.taskId - Task ID from the link (preferred over params).
 * @param props.fallbackTitle - Text to show when the note cannot be found.
 */
export function NoteChipLink({ noteId, taskId: propTaskId, fallbackTitle }: Props) {
  const router = useRouter();
  const params = useParams();
  const note = useNoteStore((s) => s.notes.find((n) => n.id === noteId));
  const openModal = useNoteStore((s) => s.openModal);
  const setCurrentNote = useNoteStore((s) => s.setCurrentNote);
  const title = note?.title || fallbackTitle || '(無題)';
  const isInSlidePanel = useIsInSlidePanel();

  // Prefer the taskId encoded in the link; fall back to current route params (old format).
  const taskId = propTaskId || (params?.id as string | undefined);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isInSlidePanel) {
      // NOTE: Inside TaskSlidePanel we open the note in the existing modal overlay
      // instead of navigating away, so the slide panel stays open and visible.
      setCurrentNote(noteId);
      openModal();
      return;
    }
    if (taskId && taskId !== '_placeholder') {
      // NOTE: showHeader=true ensures the app header stays visible in the split view
      // regardless of what context the user came from (page mode or slide panel).
      router.push(`/tasks/${taskId}?showHeader=true&note=${noteId}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={`ノート「${title}」を開く`}
      className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300 dark:hover:bg-blue-900/40"
    >
      <NotebookPen className="h-3.5 w-3.5 shrink-0" />
      {title}
    </button>
  );
}
