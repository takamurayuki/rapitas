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

// CommonMark fences: an opener of 3+ backticks or tildes (indented up to 3
// spaces), closed only by a line of the SAME character, at least as long,
// with nothing but spaces after it. A backtick opener's info string may not
// contain a backtick — such a line is not a fence at all.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
// CommonMark line endings are LF, CRLF or a lone CR. A blank line holds only
// spaces and tabs: NBSP and other Unicode spaces are ordinary characters, so
// `trim()` (which strips them) must not decide where a paragraph ends.
const LINE_BREAK = /\r\n|\r|\n/;
const BLANK_LINE = /^[ \t]*$/;
// An ATX heading is a block of its own; it interrupts a paragraph, so a code
// span can neither run into it nor out of it.
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;

function backtickRunEnd(text: string, from: number): number {
  let end = from;
  while (text[end] === '`') end += 1;
  return end;
}

/**
 * One paragraph with its code spans removed (CommonMark code spans): a run of
 * N backticks opens a span that only a run of exactly N closes, the span may
 * cross line breaks inside the paragraph, and a backslash before a backtick
 * outside a span makes it literal. An unmatched run is literal text.
 */
function withoutCodeSpans(paragraph: string): string {
  let out = '';
  let i = 0;
  while (i < paragraph.length) {
    const ch = paragraph[i];
    if (ch === '\\') {
      out += paragraph.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch !== '`') {
      out += ch;
      i += 1;
      continue;
    }
    const openEnd = backtickRunEnd(paragraph, i);
    const length = openEnd - i;
    let closeEnd = -1;
    for (let k = openEnd; k < paragraph.length; ) {
      if (paragraph[k] !== '`') {
        k += 1;
        continue;
      }
      const runEnd = backtickRunEnd(paragraph, k);
      if (runEnd - k === length) {
        closeEnd = runEnd;
        break;
      }
      k = runEnd;
    }
    if (closeEnd < 0) {
      out += paragraph.slice(i, openEnd);
      i = openEnd;
    } else {
      out += ' ';
      i = closeEnd;
    }
  }
  return out;
}

/**
 * The body with fenced code blocks and code spans removed, so a tag quoted
 * as code is not taken for the editor's own. An unclosed fence runs to the
 * end of the body; a code span does not cross a blank line, a fence or an
 * ATX heading line.
 *
 * NOTE: must match `withoutCode` in the frontend's note-content-format.ts;
 * the shared table (note-content-kind.cases.json) holds both to it.
 *
 * @param content - The note body / ノート本文
 * @returns The body without code / コードを除いた本文
 */
export function withoutCode(content: string): string {
  const kept: string[] = [];
  let paragraph: string[] = [];
  let fence: { char: string; length: number } | null = null;
  const flush = () => {
    if (paragraph.length > 0) kept.push(withoutCodeSpans(paragraph.join('\n')));
    paragraph = [];
  };
  for (const line of content.split(LINE_BREAK)) {
    if (fence) {
      const close = FENCE_CLOSE.exec(line)?.[1];
      if (close && close[0] === fence.char && close.length >= fence.length) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    const marker = open?.[1];
    if (marker && !(marker[0] === '`' && (open[2] ?? '').includes('`'))) {
      flush();
      fence = { char: marker[0] ?? '`', length: marker.length };
      continue;
    }
    if (BLANK_LINE.test(line)) {
      flush();
      kept.push('');
      continue;
    }
    if (ATX_HEADING.test(line)) {
      flush();
      kept.push(withoutCodeSpans(line));
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return kept.join('\n');
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
