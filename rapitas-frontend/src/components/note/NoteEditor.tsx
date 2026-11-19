'use client';
/**
 * NoteEditor
 *
 * The note body surface behind the /notes page and the task detail's note
 * split view. Every note opens in the Markdown editor (MarkdownNoteEditor),
 * including an empty or one-line note; a note whose body is the old rich
 * editor's HTML opens read-only (LegacyHtmlNoteView) with a conversion to
 * Markdown.
 *
 * NOTE: the contentEditable rich editor no longer opens here (stage 0,
 * design §5.3): it saved HTML, and new and edited bodies are Markdown only.
 * Its parts under `editor/` stay for the header and footer the Markdown
 * editor shares.
 */
import { type Note } from '@/stores/note-store';
import MarkdownNoteEditor from './markdown-note/MarkdownNoteEditor';
import LegacyHtmlNoteView from './markdown-note/LegacyHtmlNoteView';
import { isLegacyEditorHtml } from './markdown-note/note-content-kind';

interface NoteEditorProps {
  note: Note;
}

/**
 * Opens a note in the surface that matches its body.
 *
 * @param note - The note to open / 開くノート
 */
export default function NoteEditor({ note }: NoteEditorProps) {
  // Keyed by id so switching notes remounts the surface and drops a draft.
  // The kind is read from the stored body: once a converted note is saved as
  // Markdown it moves to the Markdown editor.
  if (isLegacyEditorHtml(note.content)) return <LegacyHtmlNoteView key={note.id} note={note} />;
  return <MarkdownNoteEditor key={note.id} note={note} />;
}
