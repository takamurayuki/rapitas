'use client';
/**
 * MarkdownNoteEditor
 *
 * Shows a Markdown note rendered with the shared MarkdownView (note density,
 * Mermaid drawn as diagrams), edits it visually (WYSIWYG: the toolbar's
 * marks, blocks, tables, diagrams, colour, highlight and size) or as its
 * plain Markdown source. Whichever way it is edited, it is saved as Markdown
 * — with colour, highlight, size and underline as the allowed inline HTML —
 * so a note ラピ or the phone wrote keeps its form.
 * Since stage 0 every new or edited note is saved from here, so the save
 * refuses a body that is the old editor's HTML (the server would answer 400)
 * and strips disallowed inline HTML as the server does.
 * Not responsible for notes already in that HTML — see LegacyHtmlNoteView.
 */
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type Note, useNoteStore } from '@/stores/note-store';
import { MarkdownView } from '@/components/markdown/MarkdownView';
import NoteEditorHeader from '../editor/NoteEditorHeader';
import NoteEditorFooter from '../editor/NoteEditorFooter';
import { checkNewMarkdownContent, prepareNewMarkdownContent } from './note-content-kind';
import {
  WysiwygNoteSurface,
  markdownToEditableHtml,
  roundTripChanges,
  type WysiwygSurfaceHandle,
} from './wysiwyg';

// NOTE: 'edit' is now the visual editor; the plain-text source moved to 'source'.
type Mode = 'view' | 'edit' | 'source';

interface MarkdownNoteEditorProps {
  /** The Markdown note to show / 表示する Markdown のノート */
  note: Note;
}

/**
 * Rendered view, visual editing and plain-source editing for one Markdown note.
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
  const [editHtml, setEditHtml] = useState('');
  const [surfaceKey, setSurfaceKey] = useState(0);
  const [rewriteNotice, setRewriteNotice] = useState(false);
  const surface = useRef<WysiwygSurfaceHandle | null>(null);
  // Only a real edit on the surface may replace the draft: opening a note
  // visually must not rewrite it into the writer's spelling (`*` → `-` …).
  const surfaceEdited = useRef(false);
  const ts = useTranslations('notes.sync');
  // Only HTML is refused; an empty body or a single plain line saves as is.
  const rejection = checkNewMarkdownContent(draftContent);

  /** The body as it stands now, the surface written back first. */
  const currentContent = (): string => {
    if (mode === 'edit' && surfaceEdited.current && surface.current) {
      return surface.current.flush();
    }
    return draftContent;
  };

  const switchMode = (target: Mode) => {
    if (target === mode) return;
    const content = currentContent();
    if (target === 'edit') {
      // Built in this click handler: markdownToEditableHtml renders synchronously.
      const html = markdownToEditableHtml(content);
      setEditHtml(html);
      setRewriteNotice(roundTripChanges(content, html));
      surfaceEdited.current = false;
      setSurfaceKey((k) => k + 1);
    }
    setDraftContent(content);
    setMode(target);
  };

  const handleSave = () => {
    const content = currentContent();
    const prepared = prepareNewMarkdownContent(content);
    if (!isDirty || !prepared.ok) return;
    updateNote(note.id, { title: draftTitle, content: prepared.content });
    setDraftContent(prepared.content);
    setIsDirty(false);
  };

  const modeButton = (target: Mode, label: string) => (
    <button
      type="button"
      onClick={() => switchMode(target)}
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
          {modeButton('source', t('markdownNote.source'))}
        </div>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {t('markdownNote.formatHint')}
        </span>
        {rejection === 'legacy_html' && (
          <span role="alert" className="text-[11px] text-red-600 dark:text-red-400">
            {ts('legacy_html')}
          </span>
        )}
      </div>

      {mode === 'edit' && rewriteNotice && (
        <p
          role="status"
          className="px-4 py-1.5 text-[11px] text-amber-800 bg-amber-50 border-b border-amber-200 dark:text-amber-200 dark:bg-amber-950/40 dark:border-amber-900"
        >
          {t('markdownNote.roundTripNotice')}
        </p>
      )}

      <div className="relative flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {mode === 'edit' ? (
          <WysiwygNoteSurface
            key={surfaceKey}
            initialHtml={editHtml}
            handleRef={surface}
            onEdit={() => {
              surfaceEdited.current = true;
              setIsDirty(true);
            }}
            onMarkdown={(markdown) => {
              if (surfaceEdited.current) setDraftContent(markdown);
            }}
          />
        ) : mode === 'source' ? (
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
