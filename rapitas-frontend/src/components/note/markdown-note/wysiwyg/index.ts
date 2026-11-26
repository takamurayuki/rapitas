/**
 * wysiwyg
 *
 * Public API of the note's visual (WYSIWYG) editor: the surface, the
 * Markdown-to-editable-HTML step and the commands.
 */
export { default as WysiwygNoteSurface, type WysiwygSurfaceHandle } from './WysiwygNoteSurface';
export { markdownToEditableHtml, roundTripChanges } from './markdown-to-editable-html';
export * from './wysiwyg-commands';
export { NOTE_FONT_SIZES, NOTE_HIGHLIGHT_COLORS, NOTE_TEXT_COLORS } from './wysiwyg-palette';
