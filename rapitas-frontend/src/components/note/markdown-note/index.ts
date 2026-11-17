/**
 * note/markdown-note
 *
 * Markdown note bodies on the desktop: telling them apart from the rich
 * editor's HTML, previewing either as plain text, and showing / editing a
 * Markdown note with the shared MarkdownView.
 */
export { default as MarkdownNoteEditor } from './MarkdownNoteEditor';
export { isMarkdownNoteContent, noteContentToPlainText } from './note-content-format';
