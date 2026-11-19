/**
 * NoteLinksSection
 *
 * Accordion content shown inside the "ノート" accordion item in CompactTaskDetailCard.
 * Lists only notes explicitly linked to this task.
 * White-based design to match the card's light-mode aesthetic.
 */
'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { NotebookPen, Plus, Unlink, ExternalLink, Clipboard, FileInput, Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEnsureNotesLoaded, useNoteStore, type Note } from '@/stores/note-store';
import { withHeaderVisible } from '@/components/header/task-detail-link';
import { noteContentToPlainText } from '@/components/note/markdown-note/note-content-format';
import NotePicker from './note-links/NotePicker';

interface Props {
  taskId: number;
  taskTitle?: string;
  themeName?: string;
  categoryName?: string;
  /** Called with a markdown link string when the user clicks "説明欄へ挿入" */
  onInsertToDescription?: (link: string) => void;
}

function formatDate(d: Date | string): string {
  const date = new Date(d);
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

/** Relative URL format avoids react-markdown's defaultUrlTransform protocol filter. */
function buildMarkdownLink(note: Note, taskId: number, untitledLabel: string): string {
  const title = note.title || untitledLabel;
  return `[${title}](/rapitas-note/${taskId}/${note.id})`;
}

function CopyButton({ note, taskId }: { note: Note; taskId: number }) {
  const t = useTranslations('task');
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = buildMarkdownLink(note, taskId, t('noteChipLink.untitled'));
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const el = document.createElement('textarea');
      el.value = link;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      title={t('noteLinksSection.copyLinkTooltip')}
      className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${
        copied
          ? 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400'
          : 'text-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:text-blue-500 dark:hover:bg-blue-950/30 dark:hover:text-blue-400'
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
      {copied ? t('noteLinksSection.copied') : t('noteLinksSection.copyLink')}
    </button>
  );
}

function InsertButton({
  note,
  taskId,
  onInsert,
}: {
  note: Note;
  taskId: number;
  onInsert: (link: string) => void;
}) {
  const t = useTranslations('task');
  const [inserted, setInserted] = useState(false);

  const handleInsert = (e: React.MouseEvent) => {
    e.stopPropagation();
    onInsert(buildMarkdownLink(note, taskId, t('noteChipLink.untitled')));
    setInserted(true);
    setTimeout(() => setInserted(false), 2000);
  };

  return (
    <button
      onClick={handleInsert}
      title={t('noteLinksSection.insertTooltip')}
      className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${
        inserted
          ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400'
          : 'text-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:text-blue-500 dark:hover:bg-blue-950/30 dark:hover:text-blue-400'
      }`}
    >
      {inserted ? <Check className="h-3.5 w-3.5" /> : <FileInput className="h-3.5 w-3.5" />}
      {inserted ? t('noteLinksSection.inserted') : t('noteLinksSection.insertToDescription')}
    </button>
  );
}

function NoteRow({
  note,
  taskId,
  onUnlink,
  onInsertToDescription,
}: {
  note: Note;
  taskId: number;
  onUnlink: (noteId: string) => void;
  onInsertToDescription?: (link: string) => void;
}) {
  const t = useTranslations('task');
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  // NOTE: noteContentToPlainText replaced a local HTML-only stripper — a
  // Markdown note saved from ラピ previewed with its marks ("## 質問 …").
  const preview =
    noteContentToPlainText(note.content).slice(0, 60) || t('noteLinksSection.noContent');

  return (
    <div
      className="group rounded-lg border border-gray-200 bg-white transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800/60 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-2.5 p-3">
        <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-400" />
        <button
          onClick={() => router.push(withHeaderVisible(`/tasks/${taskId}?note=${note.id}`))}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-medium text-gray-800 dark:text-zinc-200">
            {note.title || t('noteChipLink.untitled')}
          </p>
          <p className="truncate text-xs text-gray-400 dark:text-zinc-500">{preview}</p>
          <p className="mt-0.5 text-[11px] text-gray-300 dark:text-zinc-600">
            {formatDate(note.updatedAt)}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => router.push(withHeaderVisible(`/tasks/${taskId}?note=${note.id}`))}
            title={t('noteLinksSection.openSplitView')}
            className="rounded p-1 text-gray-300 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnlink(note.id);
            }}
            title={t('noteLinksSection.unlink')}
            className="rounded p-1 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-400 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
          >
            <Unlink className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {hovered && (
        <div className="flex items-center gap-1 border-t border-gray-100 px-3 py-1.5 dark:border-zinc-700">
          <CopyButton note={note} taskId={taskId} />
          {onInsertToDescription && (
            <>
              <div className="h-3.5 w-px bg-gray-200 dark:bg-zinc-700" />
              <InsertButton note={note} taskId={taskId} onInsert={onInsertToDescription} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Notes section rendered inside the "ノート" accordion in CompactTaskDetailCard.
 *
 * @param props.taskId - ID of the task whose linked notes to display.
 */
export default function NoteLinksSection({
  taskId,
  taskTitle,
  themeName,
  categoryName,
  onInsertToDescription,
}: Props) {
  const t = useTranslations('task');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  // NOTE: Use individual selectors so NoteLinksSection only re-renders when
  // notes change, not on every note store update (e.g. modal position changes).
  const notes = useNoteStore((s) => s.notes);
  const linkNoteToTask = useNoteStore((s) => s.linkNoteToTask);
  const unlinkNoteFromTask = useNoteStore((s) => s.unlinkNoteFromTask);
  // The task's "資料" come from the server's links (design §5.1, stage 0).
  useEnsureNotesLoaded();

  const linkedNotes = useMemo(
    () => notes.filter((n) => n.linkedTaskIds?.includes(taskId)),
    [notes, taskId],
  );

  // NOTE: One-time backfill — notes linked before linkedTaskMeta was introduced
  // lack hierarchy metadata. themeName alone is sufficient (category is optional;
  // notes without a category appear under a 2-level theme > task group).
  useEffect(() => {
    if (!themeName) return;
    // NOTE: local (pre-migration) store only. On the server POST /links
    // replaces meta, and the server's meta is not to be overwritten.
    if (useNoteStore.getState().source !== 'local') return;
    const storeNotes = useNoteStore.getState().notes;
    storeNotes
      .filter((n) => n.linkedTaskIds?.includes(taskId))
      .forEach((note) => {
        if (!note.linkedTaskMeta?.[taskId]) {
          void linkNoteToTask(note.id, taskId, {
            taskTitle: taskTitle ?? '',
            themeName,
            categoryName: categoryName ?? '',
          });
        }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      {/* Link button */}
      <button
        ref={anchorRef}
        onClick={() => setIsPickerOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 py-2 text-sm text-gray-500 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/20 dark:hover:text-indigo-400"
      >
        <Plus className="h-3.5 w-3.5" />
        {t('noteLinksSection.linkNote')}
      </button>

      {isPickerOpen && (
        <NotePicker
          taskId={taskId}
          linkedNoteIds={new Set(linkedNotes.map((n) => n.id))}
          onLink={(noteId) =>
            linkNoteToTask(noteId, taskId, {
              taskTitle: taskTitle ?? '',
              themeName: themeName ?? '',
              categoryName: categoryName ?? '',
            })
          }
          onClose={() => setIsPickerOpen(false)}
          anchorRef={anchorRef}
          taskMeta={{
            taskTitle: taskTitle ?? '',
            themeName: themeName ?? '',
            categoryName: categoryName ?? '',
          }}
        />
      )}

      {/* Linked notes list */}
      {linkedNotes.length > 0 ? (
        <div className="space-y-2">
          {linkedNotes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              taskId={taskId}
              onUnlink={(noteId) => unlinkNoteFromTask(noteId, taskId)}
              onInsertToDescription={onInsertToDescription}
            />
          ))}
          <p className="text-[11px] text-gray-300 dark:text-zinc-600">
            {t('noteLinksSection.hoverHint')}
          </p>
        </div>
      ) : (
        <p className="py-1 text-center text-xs text-gray-400 dark:text-zinc-600">
          {t('noteLinksSection.noLinkedNotes')}
        </p>
      )}
    </div>
  );
}
