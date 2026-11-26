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
import { INLINE_PAIR_TAGS, RAW_TEXT_TAGS, scanTagAt } from './inline-html-tag';

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

function rawTextEnd(text: string, from: number, name: string): number {
  const close = new RegExp(`</${name}\\s*>`, 'ig');
  close.lastIndex = from;
  const found = close.exec(text);
  return found ? found.index + found[0].length : -1;
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
  for (const segment of segments) {
    if (segment.block !== block) {
      // An unclosed start tag's slot stays empty: it is removed.
      stack = [];
      block = segment.block;
    }
    if (segment.code) {
      text += segment.text;
      continue;
    }
    const s = segment.text;
    let i = 0;
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
        text += escapeStray ? '&lt;' : ch;
        i += 1;
        continue;
      }
      i = tag.end;
      if (RAW_TEXT_TAGS.has(tag.name)) {
        if (!tag.closing) {
          const end = rawTextEnd(s, tag.end, tag.name);
          if (end > 0) i = end;
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
      let k = stack.length - 1;
      while (k >= 0 && stack[k]?.name !== tag.name) k -= 1;
      // An end tag with no start tag of its name in this block is removed.
      if (k < 0) continue;
      const open = stack[k] as OpenTag;
      // Start tags opened inside it and never closed are removed.
      stack = stack.slice(0, k);
      if (open.canonical) {
        parts[open.slot] = open.canonical;
        parts.push(`</${open.name}>`);
      }
    }
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
