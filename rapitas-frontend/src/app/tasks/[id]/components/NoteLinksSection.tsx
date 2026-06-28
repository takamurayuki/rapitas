/**
 * NoteLinksSection
 *
 * Accordion content shown inside the "ノート" accordion item in CompactTaskDetailCard.
 * Lists only notes explicitly linked to this task.
 * White-based design to match the card's light-mode aesthetic.
 */
'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  NotebookPen,
  Plus,
  Unlink,
  ExternalLink,
  Search,
  X,
  Clipboard,
  FileInput,
  Check,
} from 'lucide-react';
import { useNoteStore, type Note } from '@/stores/note-store';

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

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/** Relative URL format avoids react-markdown's defaultUrlTransform protocol filter. */
function buildMarkdownLink(note: Note, taskId: number): string {
  const title = note.title || '(無題)';
  return `[${title}](/rapitas-note/${taskId}/${note.id})`;
}

function CopyButton({ note, taskId }: { note: Note; taskId: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const link = buildMarkdownLink(note, taskId);
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
      title="Markdownリンクをクリップボードにコピー"
      className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${
        copied
          ? 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400'
          : 'text-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:text-blue-500 dark:hover:bg-blue-950/30 dark:hover:text-blue-400'
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Clipboard className="h-3.5 w-3.5" />}
      {copied ? 'コピー済み' : 'リンクをコピー'}
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
  const [inserted, setInserted] = useState(false);

  const handleInsert = (e: React.MouseEvent) => {
    e.stopPropagation();
    onInsert(buildMarkdownLink(note, taskId));
    setInserted(true);
    setTimeout(() => setInserted(false), 2000);
  };

  return (
    <button
      onClick={handleInsert}
      title="説明欄へリンクを直接挿入"
      className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${
        inserted
          ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400'
          : 'text-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:text-blue-500 dark:hover:bg-blue-950/30 dark:hover:text-blue-400'
      }`}
    >
      {inserted ? <Check className="h-3.5 w-3.5" /> : <FileInput className="h-3.5 w-3.5" />}
      {inserted ? '挿入済み' : '説明欄へ挿入'}
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
  const router = useRouter();
  const [hovered, setHovered] = useState(false);
  const preview = stripHtml(note.content).slice(0, 60) || '(内容なし)';

  return (
    <div
      className="group rounded-lg border border-gray-200 bg-white transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800/60 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-2.5 p-3">
        <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500 dark:text-indigo-400" />
        <button
          onClick={() => router.push(`/tasks/${taskId}?note=${note.id}`)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-medium text-gray-800 dark:text-zinc-200">
            {note.title || '(無題)'}
          </p>
          <p className="truncate text-xs text-gray-400 dark:text-zinc-500">{preview}</p>
          <p className="mt-0.5 text-[11px] text-gray-300 dark:text-zinc-600">
            {formatDate(note.updatedAt)}
          </p>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => router.push(`/tasks/${taskId}?note=${note.id}`)}
            title="スプリットビューで開く"
            className="rounded p-1 text-gray-300 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:text-zinc-600 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnlink(note.id);
            }}
            title="紐づけを解除"
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
 * Portal-based note picker — rendered at document.body to escape accordion
 * overflow clipping. Positioned via fixed coordinates from the anchor button.
 */
function NotePicker({
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
        return n.title.toLowerCase().includes(q) || stripHtml(n.content).toLowerCase().includes(q);
      }),
    [notes, linkedNoteIds, query],
  );

  const handlePick = (noteId: string) => {
    onLink(noteId);
    onClose();
  };

  const handleCreateAndLink = () => {
    const beforeIds = new Set(notes.map((n) => n.id));
    createNote();
    setTimeout(() => {
      const newNote = useNoteStore.getState().notes.find((n) => !beforeIds.has(n.id));
      if (newNote) linkNoteToTask(newNote.id, taskId, taskMeta);
    }, 0);
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
          placeholder="ノートを検索…"
          className="flex-1 bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none dark:text-zinc-200 dark:placeholder:text-zinc-600"
        />
        <button
          onClick={onClose}
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
          新しいノートを作成して紐づける
        </button>

        {available.length === 0 && (
          <p className="px-3 py-3 text-center text-xs text-gray-400 dark:text-zinc-600">
            {query ? `「${query}」に一致するノートはありません` : '紐づけ可能なノートがありません'}
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
              {note.title || '(無題)'}
            </span>
            <span className="ml-5 truncate text-xs text-gray-400 dark:text-zinc-500">
              {stripHtml(note.content).slice(0, 50) || '(内容なし)'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );

  return createPortal(pickerEl, document.body);
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
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  // NOTE: Use individual selectors so NoteLinksSection only re-renders when
  // notes change, not on every note store update (e.g. modal position changes).
  const notes = useNoteStore((s) => s.notes);
  const linkNoteToTask = useNoteStore((s) => s.linkNoteToTask);
  const unlinkNoteFromTask = useNoteStore((s) => s.unlinkNoteFromTask);

  const linkedNotes = useMemo(
    () => notes.filter((n) => n.linkedTaskIds?.includes(taskId)),
    [notes, taskId],
  );

  // NOTE: One-time backfill — notes linked before linkedTaskMeta was introduced
  // lack hierarchy metadata. themeName alone is sufficient (category is optional;
  // notes without a category appear under a 2-level theme > task group).
  useEffect(() => {
    if (!themeName) return;
    const storeNotes = useNoteStore.getState().notes;
    storeNotes
      .filter((n) => n.linkedTaskIds?.includes(taskId))
      .forEach((note) => {
        if (!note.linkedTaskMeta?.[taskId]) {
          linkNoteToTask(note.id, taskId, {
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
        ノートを紐づける
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
            ノートにカーソルを合わせると「リンクをコピー」と「説明欄へ挿入」が表示されます。
          </p>
        </div>
      ) : (
        <p className="py-1 text-center text-xs text-gray-400 dark:text-zinc-600">
          紐づけられたノートはありません
        </p>
      )}
    </div>
  );
}
