/**
 * NoteEditorHeader
 *
 * Renders the top bar of the NoteEditor: title input, pin button,
 * flashcard generation button, and save button.
 * Does not own any state; all values and handlers are passed as props.
 */
'use client';
import { Save, Pin, Layers, Loader2 } from 'lucide-react';
import { type Note } from '@/stores/note-store';
import { type FlashcardResult } from './useNoteEditor';

interface NoteEditorHeaderProps {
  note: Note;
  draftTitle: string;
  isDirty: boolean;
  locale: string;
  isGeneratingFlashcards: boolean;
  flashcardResult: FlashcardResult | null;
  onTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onTitlePaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  onSave: () => void;
  onTogglePin: () => void;
  onGenerateFlashcards: () => void;
}

/**
 * Top action bar for the note editor.
 *
 * @param props - Title state, save/pin/flashcard handlers, and locale.
 */
export default function NoteEditorHeader({
  note,
  draftTitle,
  isDirty,
  locale,
  isGeneratingFlashcards,
  flashcardResult,
  onTitleChange,
  onTitlePaste,
  onSave,
  onTogglePin,
  onGenerateFlashcards,
}: NoteEditorHeaderProps) {
  return (
    <>
      {/* Title row */}
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
          onClick={onGenerateFlashcards}
          disabled={isGeneratingFlashcards}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0 bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-50 disabled:cursor-wait"
          title={
            locale === 'ja' ? 'フラッシュカード生成' : 'Generate Flashcards'
          }
        >
          {isGeneratingFlashcards ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Layers className="w-3.5 h-3.5" />
          )}
          {isGeneratingFlashcards
            ? locale === 'ja'
              ? '生成中...'
              : 'Generating...'
            : locale === 'ja'
              ? 'カード生成'
              : 'Flashcards'}
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

      {/* Flashcard generation result banner */}
      {flashcardResult && (
        <div className="mx-4 mb-2 flex items-center justify-between px-3 py-2 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700">
          <span className="text-sm text-violet-700 dark:text-violet-300">
            {locale === 'ja'
              ? `「${flashcardResult.deckName}」に${flashcardResult.cardsCreated}枚のカードを生成しました`
              : `Generated ${flashcardResult.cardsCreated} cards in "${flashcardResult.deckName}"`}
          </span>
          <a
            href="/flashcards"
            className="text-sm font-medium text-violet-600 dark:text-violet-400 hover:underline"
          >
            {locale === 'ja' ? '確認する →' : 'View →'}
          </a>
        </div>
      )}
    </>
  );
}
