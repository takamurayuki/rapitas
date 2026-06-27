/**
 * NoteChipLink
 *
 * Confluence-style inline note link chip rendered inside task descriptions.
 * Reads the note title from the local store so it stays current after renames.
 * On click, navigates to the task's split view (/tasks/:taskId?note=:noteId).
 *
 * taskId comes from the link itself (/rapitas-note/{taskId}/{noteId} format),
 * so this chip works correctly when rendered on any page, not just the task detail.
 */
'use client';

import { useParams, useRouter } from 'next/navigation';
import { NotebookPen } from 'lucide-react';
import { useNoteStore } from '@/stores/note-store';

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
  const title = note?.title || fallbackTitle || '(無題)';

  // Prefer the taskId encoded in the link; fall back to current route params (old format).
  const taskId = propTaskId || (params?.id as string | undefined);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
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
      className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
    >
      <NotebookPen className="h-3.5 w-3.5 shrink-0" />
      {title}
    </button>
  );
}
