/**
 * inline-html
 *
 * Public API of the allowed inline HTML rules for Markdown notes (text colour,
 * highlight, font size, underline): the save-time strip, the tag reader, the
 * code splitter and the Markdown renderer plugin.
 */
export {
  INLINE_PAIR_TAGS,
  NOTE_FONT_SIZE_MAX,
  NOTE_FONT_SIZE_MIN,
  parseInlineHtmlTag,
} from './inline-html-tag';
export { sanitizeNoteInlineHtml } from './note-inline-html';
export { splitByCode, type CodeSegment } from './split-by-code';
export { default as remarkNoteInlineHtml } from './remark-note-inline-html';
