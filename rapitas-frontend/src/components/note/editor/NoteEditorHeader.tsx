'use client';
// NoteEditorHeader
import { Save, Pin } from 'lucide-react';
import { type Note } from '@/stores/note-store';

interface NoteEditorHeaderProps {
  note: Note;
  draftTitle: string;
  isDirty: boolean;
  onTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onTitlePaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onTogglePin: () => void;
}

/**
 * Top action bar for the note editor.
 *
 * @param props - Title state and save/pin handlers.
 */
export default function NoteEditorHeader({
  note,
  draftTitle,
  isDirty,
  onTitleChange,
  onTitlePaste,
  onSave,
  onTogglePin,
}: NoteEditorHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 pt-3 pb-2">
      <input
        type="text"
        value={draftTitle}
        onChange={onTitleChange}
        onPaste={onTitlePaste}
        className="flex-1 text-xl font-bold bg-transparent outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-zinc-900 dark:text-zinc-100"
        placeholder="タイトルを入力..."
        style={{
          fontStyle: 'normal',
          textDecoration: 'none',
          fontWeight: 700,
        }}
      />
      <button
        onClick={onTogglePin}
        className={`p-1.5 rounded-lg transition-colors shrink-0 ${
          note.isPinned
            ? 'text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20'
            : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
        }`}
        title={note.isPinned ? 'ピンを外す' : 'ピン留め'}
      >
        <Pin className="w-4 h-4" />
      </button>
      <button
        onClick={onSave}
        disabled={!isDirty}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0 ${
          isDirty
            ? 'bg-indigo-500 hover:bg-indigo-600 text-white'
            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 cursor-default'
        }`}
        title="保存（Ctrl+S）"
      >
        <Save className="w-3.5 h-3.5" />
        {isDirty ? '保存' : '保存済み'}
      </button>
    </div>
  );
}
