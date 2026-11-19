/**
 * NoteContentKind
 *
 * The two save-time rules for a note body (design §5.3): recognising the old
 * desktop rich editor's HTML, and accepting a new Markdown body.
 *
 * They are deliberately separate from the frontend's `isMarkdownNoteContent`,
 * which routes a body to an editor and calls an empty body or one plain line
 * "not Markdown". Used as a save check, that would refuse an empty learning
 * note or an ordinary one-line memo. These rules only refuse a body that
 * carries the rich editor's tags outside code.
 *
 * The same rules live in the frontend (`note-content-kind.ts`); both test
 * suites read `note-content-kind.cases.json` so the two cannot drift apart.
 * Not responsible for the Markdown format rules (those instruct generation,
 * not validation — see note-format-rules).
 */
import { MAX_NOTE_CONTENT } from './note-limits';

// NOTE: must match EDITOR_HTML_TAG in the frontend's note-content-format.ts —
// it is the list of tags the contentEditable editor writes.
const EDITOR_HTML_TAG =
  /<\/?(p|div|br|span|font|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|pre|code|blockquote|strong|b|em|i|u|s|strike|a|img|hr|mark)(\s[^<>]*)?\/?>/i;

const FENCE_BLOCK = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;
const INLINE_CODE = /`[^`\n]+`/g;

function withoutCode(content: string): string {
  return content.replace(FENCE_BLOCK, '').replace(INLINE_CODE, '');
}

/**
 * Whether a body is the old rich editor's HTML.
 *
 * True only when an editor tag remains once fenced and inline code are
 * removed. An empty body, one line, or a body of entity references alone is
 * valid Markdown text and is false.
 *
 * @param content - The note body / ノート本文
 * @returns true for legacy editor HTML / 旧エディタの HTML なら true
 */
export function isLegacyEditorHtml(content: string): boolean {
  if (content.trim() === '') return false;
  return EDITOR_HTML_TAG.test(withoutCode(content));
}

/** Why a body was refused as a new Markdown note. */
export type NewMarkdownRejection = 'legacy_html' | 'too_long';

/**
 * Check a body that a normal create or edit wants to save.
 *
 * Accepts empty bodies and plain lines; Markdown marks are not required.
 *
 * @param content - The body to save / 保存する本文
 * @returns null when accepted, otherwise the reason / 受け付けるなら null、拒否なら理由
 */
export function checkNewMarkdownContent(content: string): NewMarkdownRejection | null {
  if (content.length > MAX_NOTE_CONTENT) return 'too_long';
  if (isLegacyEditorHtml(content)) return 'legacy_html';
  return null;
}
