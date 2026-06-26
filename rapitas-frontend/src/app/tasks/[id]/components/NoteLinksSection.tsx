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
import { NotebookPen, Plus, Unlink, ExternalLink, Search, X, Link2, Check } from 'lucide-react';
import { useNoteStore, type Note } from '@/stores/note-store';

interface Props {
  taskId: number;
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
      title="説明欄に貼り付けるリンクをコピー"
      className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${
        copied
          ? 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400'
          : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:text-zinc-500 dark:hover:bg-zinc-700 dark:hover:text-zinc-300'
      }`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
      {copied ? 'コピー済み' : 'リンクをコピー'}
    </button>
  );
}

function NoteRow({
  note,
  taskId,
  onUnlink,
}: {
  note: Note;
  taskId: number;
  onUnlink: (noteId: string) => void;
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
        <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400" />
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
          <span className="mr-1 text-xs text-gray-400 dark:text-zinc-500">説明欄へ挿入:</span>
          <CopyButton note={note} taskId={taskId} />
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
}: {
  taskId: number;
  linkedNoteIds: Set<string>;
  onLink: (noteId: string) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
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
      if (newNote) linkNoteToTask(newNote.id, taskId);
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
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
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
              <NotebookPen className="h-3.5 w-3.5 shrink-0 text-blue-500 dark:text-blue-400" />
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
export default function NoteLinksSection({ taskId }: Props) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  // Subscribe directly to notes for reactive filtering
  const notes = useNoteStore((s) => s.notes);
  const { linkNoteToTask, unlinkNoteFromTask } = useNoteStore();

  const linkedNotes = useMemo(
    () => notes.filter((n) => n.linkedTaskIds?.includes(taskId)),
    [notes, taskId],
  );

  return (
    <div className="space-y-2">
      {/* Link button */}
      <button
        ref={anchorRef}
        onClick={() => setIsPickerOpen((v) => !v)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 py-2 text-sm text-gray-500 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-blue-600 dark:hover:bg-blue-950/20 dark:hover:text-blue-400"
      >
        <Plus className="h-3.5 w-3.5" />
        ノートを紐づける
      </button>

      {isPickerOpen && (
        <NotePicker
          taskId={taskId}
          linkedNoteIds={new Set(linkedNotes.map((n) => n.id))}
          onLink={(noteId) => linkNoteToTask(noteId, taskId)}
          onClose={() => setIsPickerOpen(false)}
          anchorRef={anchorRef}
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
            />
          ))}
          <p className="text-[11px] text-gray-300 dark:text-zinc-600">
            ノートにカーソルを合わせると「リンクをコピー」が表示されます。説明欄に貼り付けるとクリッカブルなノートリンクになります。
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
