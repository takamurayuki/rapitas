/**
 * NoteInlineHtml
 *
 * The save-time strip of a Markdown note's HTML: the four allowed inline
 * forms (text colour, highlight, font size, underline) are kept in their
 * canonical spelling, every other tag, attribute, comment and script is
 * removed. Code (fences and code spans) is never touched.
 * Not responsible for refusing the old editor's HTML; that verdict stays in
 * note-content-kind.ts and runs first (`prepareNewMarkdownContent`).
 *
 * NOTE: the frontend's markdown-note/inline-html/note-inline-html.ts holds
 * the same rules; both tests read note-inline-html.cases.json.
 */
import {
  checkNewMarkdownContent,
  splitByCode,
  type CodeSegment,
  type NewMarkdownRejection,
} from '../note-content-kind';
import { INLINE_PAIR_TAGS, RAW_TEXT_TAGS, looksLikeTagAt, scanTagAt } from './inline-html-tag';

// Removing a tag can join two pieces of text into a new tag (`<<b>script>`),
// so the strip runs until nothing changes. Past this many passes the input is
// hostile and every stray `<` is written as `&lt;` instead.
const MAX_PASSES = 16;

// Markup that never carries prose: removed whole when it is terminated.
const DECLARATIONS: ReadonlyArray<{ open: string; close: string }> = [
  { open: '<!--', close: '-->' },
  { open: '<![CDATA[', close: ']]>' },
  { open: '<?', close: '?>' },
];
const BANG_DECLARATION = /<![A-Za-z][^>]*>/y;

/** A start tag waiting for its end tag within the current block. */
interface OpenTag {
  name: string;
  slot: number;
  canonical: string | null;
}

function declarationEnd(text: string, at: number): number {
  for (const d of DECLARATIONS) {
    if (!text.startsWith(d.open, at)) continue;
    const close = text.indexOf(d.close, at + d.open.length);
    return close < 0 ? -1 : close + d.close.length;
  }
  BANG_DECLARATION.lastIndex = at;
  const bang = BANG_DECLARATION.exec(text);
  return bang ? at + bang[0].length : -1;
}

/**
 * Where a raw-text element (script, style …) ends: the end of its end tag,
 * searched from `from` in segment `k` and on through the later pieces of the
 * same paragraph — code spans included, because backticks inside a script
 * are not Markdown code.
 */
function rawTextEnd(
  segments: CodeSegment[],
  k: number,
  from: number,
  name: string,
): { seg: number; pos: number } | null {
  const block = segments[k]?.block;
  for (let j = k; j < segments.length && segments[j]?.block === block; j += 1) {
    const close = new RegExp(`</${name}\\s*>`, 'ig');
    close.lastIndex = j === k ? from : 0;
    const found = close.exec(segments[j]?.text ?? '');
    if (found) return { seg: j, pos: found.index + found[0].length };
  }
  return null;
}

/** One pass over the body; `escapeStray` writes every unkept `<` as `&lt;`. */
function stripOnce(segments: CodeSegment[], escapeStray: boolean): string {
  const parts: string[] = [];
  let stack: OpenTag[] = [];
  let block = -1;
  let text = '';
  const flushText = () => {
    if (text !== '') parts.push(text);
    text = '';
  };
  let k = 0;
  // Where to start reading segment k (non-zero after a raw-text jump).
  let startAt = 0;
  while (k < segments.length) {
    const segment = segments[k] as CodeSegment;
    if (segment.block !== block) {
      // An unclosed start tag's slot stays empty: it is removed.
      stack = [];
      block = segment.block;
    }
    const s = segment.text;
    let i = startAt;
    startAt = 0;
    if (segment.code) {
      text += s.slice(i);
      k += 1;
      continue;
    }
    let jumped = false;
    while (i < s.length) {
      const ch = s[i] as string;
      if (ch !== '<') {
        text += ch;
        i += 1;
        continue;
      }
      const declEnd = declarationEnd(s, i);
      if (declEnd > 0) {
        i = declEnd;
        continue;
      }
      const tag = scanTagAt(s, i);
      if (!tag) {
        // Starts like a tag but cannot be read as one (an unterminated quote):
        // removed up to its `>` rather than kept as text with its attributes.
        const gt = looksLikeTagAt(s, i) ? s.indexOf('>', i) : -1;
        if (gt > 0) {
          i = gt + 1;
          continue;
        }
        text += escapeStray ? '&lt;' : ch;
        i += 1;
        continue;
      }
      i = tag.end;
      if (RAW_TEXT_TAGS.has(tag.name)) {
        const end = tag.closing ? null : rawTextEnd(segments, k, tag.end, tag.name);
        if (end && end.seg === k) i = end.pos;
        else if (end) {
          k = end.seg;
          startAt = end.pos;
          jumped = true;
          break;
        }
        continue;
      }
      if (!INLINE_PAIR_TAGS.has(tag.name)) continue;
      flushText();
      if (!tag.closing) {
        stack.push({ name: tag.name, slot: parts.length, canonical: tag.canonical });
        parts.push('');
        continue;
      }
      let top = stack.length - 1;
      while (top >= 0 && stack[top]?.name !== tag.name) top -= 1;
      // An end tag with no start tag of its name in this block is removed.
      if (top < 0) continue;
      const open = stack[top] as OpenTag;
      // Start tags opened inside it and never closed are removed.
      stack = stack.slice(0, top);
      if (open.canonical) {
        parts[open.slot] = open.canonical;
        parts.push(`</${open.name}>`);
      }
    }
    if (!jumped) k += 1;
  }
  flushText();
  return parts.join('');
}

/**
 * Strip a Markdown note body down to text plus the allowed inline forms.
 *
 * A disallowed span / mark / u loses its tags and keeps its text; script,
 * style, iframe and the like go with their content; a tag pairs only with one
 * in the same paragraph. Idempotent.
 *
 * @param content - The note body / ノート本文
 * @returns The stripped body / 許可形だけを残した本文
 */
export function sanitizeNoteInlineHtml(content: string): string {
  if (!content.includes('<')) return content;
  let current = content;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = stripOnce(splitByCode(current), false);
    if (next === current) return next;
    current = next;
  }
  return stripOnce(splitByCode(current), true);
}

/** The outcome of preparing a body for a normal create or edit. */
export type PreparedMarkdown =
  | { ok: true; content: string }
  | { ok: false; reason: NewMarkdownRejection };

/**
 * Check a new Markdown body and strip its disallowed HTML in one step.
 *
 * The old editor's HTML (div, p, br …) is refused before anything is
 * stripped, so such a note is never silently rewritten.
 * NOTE: lives here rather than in note-content-kind.ts so that module does not
 * import this one back (it provides `splitByCode`), which would be a cycle.
 *
 * @param content - The body to save / 保存する本文
 * @returns The body to store, or the refusal reason / 保存する本文、または拒否理由
 */
export function prepareNewMarkdownContent(content: string): PreparedMarkdown {
  const rejection = checkNewMarkdownContent(content);
  if (rejection) return { ok: false, reason: rejection };
  return { ok: true, content: sanitizeNoteInlineHtml(content) };
}
