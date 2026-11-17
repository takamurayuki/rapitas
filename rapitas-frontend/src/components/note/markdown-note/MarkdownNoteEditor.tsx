'use client';
/**
 * MarkdownNoteEditor
 *
 * Shows a Markdown note rendered with the shared MarkdownView (note density,
 * Mermaid drawn as diagrams) and edits it as its plain Markdown source, so a
 * note ラピ or the phone wrote keeps its form when it is saved again here.
 * Not responsible for notes written in the desktop rich editor (HTML) — those
 * stay in `NoteEditor`'s contentEditable surface.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { type Note, useNoteStore } from '@/stores/note-store';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import NoteEditorHeader from '../editor/NoteEditorHeader';
import NoteEditorFooter from '../editor/NoteEditorFooter';

type Mode = 'view' | 'edit';

interface MarkdownNoteEditorProps {
  /** The Markdown note to show / 表示する Markdown のノート */
  note: Note;
}

/**
 * Rendered view and plain-source editing for one Markdown note.
 *
 * @param note - The note to show; remount (key by id) to switch notes / 表示するノート（切り替えは id を key に再マウント）
 */
export default function MarkdownNoteEditor({ note }: MarkdownNoteEditorProps) {
  const t = useTranslations('notes');
  const updateNote = useNoteStore((s) => s.updateNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const setCurrentNote = useNoteStore((s) => s.setCurrentNote);

  const [mode, setMode] = useState<Mode>('view');
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [draftContent, setDraftContent] = useState(note.content);
  const [isDirty, setIsDirty] = useState(false);

  const handleSave = () => {
    if (!isDirty) return;
    updateNote(note.id, { title: draftTitle, content: draftContent });
    setIsDirty(false);
  };

  const modeButton = (target: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(target)}
      aria-pressed={mode === target}
      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
        mode === target
          ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-50 shadow-sm'
          : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full relative">
      <NoteEditorHeader
        note={note}
        draftTitle={draftTitle}
        isDirty={isDirty}
        onTitleChange={(e) => {
          setDraftTitle(e.target.value);
          setIsDirty(true);
        }}
        onTitlePaste={() => {}}
        onSave={handleSave}
        onDelete={() => {
          deleteNote(note.id);
          setCurrentNote(null);
        }}
        onSetDocType={(docType) => updateNote(note.id, { docType })}
      />

      <div className="flex items-center gap-2 px-4 py-1.5 border-y border-zinc-200 dark:border-zinc-700">
        <div
          role="group"
          aria-label={t('markdownNote.modeLabel')}
          className="flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5"
        >
          {modeButton('view', t('markdownNote.view'))}
          {modeButton('edit', t('markdownNote.edit'))}
        </div>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {t('markdownNote.formatHint')}
        </span>
      </div>

      <div className="relative flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {mode === 'edit' ? (
          <textarea
            value={draftContent}
            onChange={(e) => {
              setDraftContent(e.target.value);
              setIsDirty(true);
            }}
            aria-label={t('markdownNote.sourceLabel')}
            spellCheck={false}
            className="block w-full h-full min-h-full p-4 resize-none bg-transparent outline-none font-mono text-[13px] leading-relaxed text-zinc-800 dark:text-zinc-200"
          />
        ) : draftContent.trim() === '' ? (
          <p className="p-4 text-sm text-zinc-400 dark:text-zinc-500">{t('markdownNote.empty')}</p>
        ) : (
          <div className="px-4 py-3">
            <MarkdownView content={draftContent} density="note" />
          </div>
        )}
      </div>

      <NoteEditorFooter createdAt={note.createdAt} updatedAt={note.updatedAt} />
    </div>
  );
}
