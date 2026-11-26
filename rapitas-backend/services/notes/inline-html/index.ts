/**
 * inline-html
 *
 * Public API of the allowed inline HTML rules for Markdown notes.
 */
export {
  INLINE_PAIR_TAGS,
  NOTE_FONT_SIZE_MAX,
  NOTE_FONT_SIZE_MIN,
  parseInlineHtmlTag,
} from './inline-html-tag';
export {
  prepareNewMarkdownContent,
  sanitizeNoteInlineHtml,
  type PreparedMarkdown,
} from './note-inline-html';
