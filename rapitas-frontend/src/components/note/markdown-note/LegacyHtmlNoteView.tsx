'use client';
/**
 * LegacyHtmlNoteView
 *
 * A note whose body is the old rich editor's HTML (design §5.3, Q2 (a)):
 * shown read-only as it was written, with "Markdown に変換して編集", which
 * shows the converted Markdown — editable, rendered beside it — and saves
 * only when the user confirms. The title, type and delete still work, since
 * those writes do not send the body and the server accepts them.
 *
 * Not responsible for Markdown notes (MarkdownNoteEditor).
 */
import { useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { useTranslations } from 'next-intl';
import { FileCode2 } from 'lucide-react';
import { type Note, useNoteStore } from '@/stores/note-store';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import NoteEditorHeader from '../editor/NoteEditorHeader';
import NoteEditorFooter from '../editor/NoteEditorFooter';
import { htmlToMarkdown } from './html-to-markdown';
import { checkNewMarkdownContent } from './note-content-kind';

/**
 * Read-only display of a legacy HTML note, with the conversion to Markdown.
 *
 * @param note - The HTML note / HTML のノート
 */
export default function LegacyHtmlNoteView({ note }: { note: Note }) {
  const t = useTranslations('notes.legacyHtml');
  const updateNote = useNoteStore((s) => s.updateNote);
  const deleteNote = useNoteStore((s) => s.deleteNote);
  const setCurrentNote = useNoteStore((s) => s.setCurrentNote);
  const [draftTitle, setDraftTitle] = useState(note.title);
  const [titleDirty, setTitleDirty] = useState(false);
  const [converted, setConverted] = useState<string | null>(null);
  const tm = useTranslations('notes.sync');
  // Sanitized once per body; the rich editor loaded it the same way.
  const safeHtml = useMemo(() => DOMPurify.sanitize(note.content), [note.content]);

  const saveTitle = () => {
    if (!titleDirty) return;
    updateNote(note.id, { title: draftTitle });
    setTitleDirty(false);
  };

  return (
    <div className="flex flex-col h-full relative" data-testid="legacy-html-note">
      <NoteEditorHeader
        note={note}
        draftTitle={draftTitle}
        isDirty={titleDirty}
        onTitleChange={(e) => {
          setDraftTitle(e.target.value);
          setTitleDirty(true);
        }}
        onTitlePaste={() => {}}
        onSave={saveTitle}
        onDelete={() => {
          deleteNote(note.id);
          setCurrentNote(null);
        }}
        onSetDocType={(docType) => updateNote(note.id, { docType })}
      />

      <div className="flex flex-wrap items-center gap-2 px-4 py-1.5 border-y border-zinc-200 dark:border-zinc-700">
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          <FileCode2 className="h-3.5 w-3.5" />
          {t('badge')}
        </span>
        <span className="flex-1 text-[11px] text-zinc-500 dark:text-zinc-400">{t('readOnly')}</span>
        {converted === null && (
          <button
            type="button"
            onClick={() => setConverted(htmlToMarkdown(note.content))}
            className="rounded-md bg-indigo-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-600"
          >
            {t('convert')}
          </button>
        )}
      </div>

      <div className="relative flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {converted === null ? (
          <div
            className="p-4 prose prose-zinc dark:prose-invert max-w-none note-editor"
            style={{ lineHeight: '1.8', fontSize: '16px' }}
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : (
          <div className="flex h-full flex-col gap-2 p-4">
            <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
              {t('previewTitle')}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('previewHint')}</p>
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
              <textarea
                value={converted}
                onChange={(e) => setConverted(e.target.value)}
                aria-label={t('sourceLabel')}
                spellCheck={false}
                className="min-h-[16rem] resize-none rounded-lg border border-zinc-200 bg-transparent p-3 font-mono text-[13px] leading-relaxed text-zinc-800 outline-none dark:border-zinc-700 dark:text-zinc-200"
              />
              <div className="overflow-y-auto rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
                <MarkdownView content={converted} density="note" />
              </div>
            </div>
            {checkNewMarkdownContent(converted) === 'legacy_html' && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {tm('legacy_html')}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConverted(null)}
                className="rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('cancel')}
              </button>
              <button
                type="button"
                // The converted body is Markdown, so the normal save takes it; the
                // editor switches to the Markdown surface once the body changes.
                onClick={() => updateNote(note.id, { content: converted })}
                disabled={checkNewMarkdownContent(converted) !== null}
                className="rounded-md bg-indigo-500 disabled:opacity-50 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-600"
              >
                {t('save')}
              </button>
            </div>
          </div>
        )}
      </div>

      <NoteEditorFooter createdAt={note.createdAt} updatedAt={note.updatedAt} />
    </div>
  );
}
