/**
 * note-content-kind
 *
 * The save-time body rules (design §5.3), the frontend's copy of the
 * backend's `services/notes/note-content-kind.ts`: recognising the old rich
 * editor's HTML, and accepting a new Markdown body.
 *
 * Kept apart from `isMarkdownNoteContent`, which calls an empty body or one
 * plain line "not Markdown" because it once routed those to the rich editor.
 * These rules decide which editor opens, which note is read-only, and what
 * may be saved; both sides' tests read the same verdict table
 * (`rapitas-backend/services/notes/note-content-kind.cases.json`).
 */
import { EDITOR_HTML_TAG, withoutCode } from './note-content-format';
import { sanitizeNoteInlineHtml } from './inline-html';

/** Same cap as the server's MAX_NOTE_CONTENT. */
export const MAX_NOTE_CONTENT = 200_000;

/**
 * Whether a body is the old rich editor's HTML.
 *
 * True only when an editor tag remains once fenced and inline code are
 * removed; an empty body, one line, or entity references alone are false.
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
 * Check a body a normal create or edit wants to save.
 *
 * @param content - The body to save / 保存する本文
 * @returns null when accepted, otherwise the reason / 受け付けるなら null、拒否なら理由
 */
export function checkNewMarkdownContent(content: string): NewMarkdownRejection | null {
  if (content.length > MAX_NOTE_CONTENT) return 'too_long';
  if (isLegacyEditorHtml(content)) return 'legacy_html';
  return null;
}

/** The outcome of preparing a body for a normal create or edit. */
export type PreparedMarkdown =
  | { ok: true; content: string }
  | { ok: false; reason: NewMarkdownRejection };

/**
 * Check a new Markdown body and strip its disallowed inline HTML in one step,
 * as the server does on save (so a local note matches a server one).
 *
 * The old editor's HTML (div, p, br …) is refused before anything is stripped.
 *
 * @param content - The body to save / 保存する本文
 * @returns The body to store, or the refusal reason / 保存する本文、または拒否理由
 */
export function prepareNewMarkdownContent(content: string): PreparedMarkdown {
  const rejection = checkNewMarkdownContent(content);
  if (rejection) return { ok: false, reason: rejection };
  return { ok: true, content: sanitizeNoteInlineHtml(content) };
}
