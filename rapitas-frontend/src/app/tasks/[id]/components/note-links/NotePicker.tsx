'use client';
/**
 * NotePicker
 *
 * The note picker of the task detail's notes section (NoteLinksSection):
 * search the notes not yet linked to the task, link one, or create a note
 * and link it. Split out of NoteLinksSection.tsx so that file stays about
 * the linked list. Not responsible for the linked list itself.
 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { NotebookPen, Plus, Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useNoteStore } from '@/stores/note-store';
import { noteContentToPlainText } from '@/components/note/markdown-note/note-content-format';

/**
 * Portal-based note picker — rendered at document.body to escape accordion
 * overflow clipping. Positioned via fixed coordinates from the anchor button.
 */
export default function NotePicker({
  taskId,
  linkedNoteIds,
  onLink,
  onClose,
  anchorRef,
  taskMeta,
}: {
  taskId: number;
  linkedNoteIds: Set<string>;
  onLink: (noteId: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  taskMeta: { taskTitle: string; themeName: string; categoryName: string };
}) {
  const t = useTranslations('task');
  const tc = useTranslations('common');
  const [query, setQuery] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const { notes, createNote, linkNoteToTask } = useNoteStore();

  // Capture anchor position on open
  useEffect(() => {
    if (anchorRef.current) {
      setAnchorRect(anchorRef.current.getBoundingClientRect());
    }
  }, [anchorRef]);

  // Close when clicking outside both the picker and the anchor button
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (pickerRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [onClose, anchorRef]);

  const available = useMemo(
    () =>
      notes.filter((n) => {
        if (linkedNoteIds.has(n.id)) return false;
        if (!query) return true;
        const q = query.toLowerCase();
        return (
          n.title.toLowerCase().includes(q) ||
          noteContentToPlainText(n.content).toLowerCase().includes(q)
        );
      }),
    [notes, linkedNoteIds, query],
  );

  const handlePick = (noteId: string) => {
    onLink(noteId);
    onClose();
  };

  const handleCreateAndLink = () => {
    // NOTE: createNote returns the id since stage 0; on the server the link
    // is queued behind the note's own create, so it never races it.
    const id = createNote();
    void linkNoteToTask(id, taskId, taskMeta);
    onClose();
  };

  if (!anchorRect) return null;

  const pickerEl = (
    <div
      ref={pickerRef}
      style={{
        position: 'fixed',
        top: anchorRect.bottom + 4,
        left: anchorRect.left,
        width: Math.max(anchorRect.width, 280),
        zIndex: 9999,
      }}
      className="rounded-xl border border-gray-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-zinc-800">
        <Search className="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-zinc-500" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('noteLinksSection.searchPlaceholder')}
          className="flex-1 bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none dark:text-zinc-200 dark:placeholder:text-zinc-600"
        />
        <button
          onClick={onClose}
          aria-label={tc('close')}
          className="text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="max-h-56 overflow-y-auto p-1">
        <button
          onClick={handleCreateAndLink}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-indigo-600 transition-colors hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/30"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('noteLinksSection.createAndLink')}
        </button>

        {available.length === 0 && (
          <p className="px-3 py-3 text-center text-xs text-gray-400 dark:text-zinc-600">
            {query
              ? t('noteLinksSection.noMatchingNotes', { query })
              : t('noteLinksSection.noLinkableNotes')}
          </p>
        )}

        {available.map((note) => (
          <button
            key={note.id}
            onClick={() => handlePick(note.id)}
            className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-zinc-800"
          >
            <span className="flex items-center gap-1.5 truncate text-sm text-gray-700 dark:text-zinc-200">
              <NotebookPen className="h-3.5 w-3.5 shrink-0 text-indigo-500 dark:text-indigo-400" />
              {note.title || t('noteChipLink.untitled')}
            </span>
            <span className="ml-5 truncate text-xs text-gray-400 dark:text-zinc-500">
              {noteContentToPlainText(note.content).slice(0, 50) || t('noteLinksSection.noContent')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return createPortal(pickerEl, document.body);
}
