/**
 * note-content-format
 *
 * Tells the two kinds of note body apart — the desktop rich editor's HTML and
 * Markdown (what ラピ, the phone and the roadmap write) — and turns either into
 * plain text for one-line previews.
 * Not responsible for rendering; see `MarkdownNoteEditor` and `NoteEditor`.
 */

// Tags the rich editor (contentEditable + execCommand) writes. Checked after
// code is removed, so a fence or `inline code` that mentions a tag stays Markdown.
// NOTE: the backend's note-content-kind.ts holds the same list; keep them equal.
export const EDITOR_HTML_TAG =
  /<\/?(p|div|br|span|font|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|pre|code|blockquote|strong|b|em|i|u|s|strike|a|img|hr|mark)(\s[^<>]*)?\/?>/i;
const HTML_ENTITY = /&(nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/i;

// Not preceded by an odd run of backslashes: `\*` is a literal, `\\*` is a mark.
const UNESCAPED = String.raw`(?<!(?<!\\)\\(?:\\\\)*)`;
// CommonMark: `_` cannot open or close emphasis inside a word (`foo__bar__baz`).
const NOT_WORD_BEFORE = String.raw`(?<![\p{L}\p{N}_])`;
const NOT_WORD_AFTER = String.raw`(?![\p{L}\p{N}_])`;

// Line starts and inline marks that only Markdown gives a meaning to.
const MARKDOWN_SIGNALS = [
  /^ {0,3}#{1,6}\s/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+[.)]\s+\S/m,
  /^ {0,3}>/m,
  /^\s*\|.*\|\s*$/m,
  /^ {0,3}(`{3,}|~{3,})/m,
  // Paired marks only, hugging non-space text, so `3 * 5` or `a ~ b` stay plain.
  // NOTE: Both delimiters must be unescaped; `*` and `~` may sit inside a word
  // (CommonMark / GFM allow it), `__` may not.
  new RegExp(String.raw`${UNESCAPED}\*\*[^*\n]+${UNESCAPED}\*\*`),
  new RegExp(
    String.raw`${NOT_WORD_BEFORE}${UNESCAPED}__[^\s_](?:[^_\n]*[^\s_])?${UNESCAPED}__${NOT_WORD_AFTER}`,
    'u',
  ),
  new RegExp(String.raw`(?<!\*)${UNESCAPED}\*[^\s*](?:[^*\n]*[^\s*])?${UNESCAPED}\*(?!\*)`),
  new RegExp(String.raw`${UNESCAPED}~~[^\s~](?:[^~\n]*[^\s~])?${UNESCAPED}~~`),
  /\[[^\]\n]+\]\([^)\s]+\)/,
  /`[^`\n]+`/,
];

// CommonMark fences: an opener of 3+ backticks or tildes (indented up to 3
// spaces), closed only by a line of the SAME character, at least as long,
// with nothing but spaces after it. A backtick opener's info string may not
// contain a backtick — such a line is not a fence at all.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

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
 * end of the body; a code span does not cross a blank line or a fence.
 *
 * NOTE: must match `withoutCode` in the backend's services/notes/note-content-kind.ts;
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
  for (const line of content.split(/\r?\n/)) {
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
    if (line.trim() === '') {
      flush();
      kept.push('');
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return kept.join('\n');
}

/**
 * Whether a note body is Markdown rather than the rich editor's HTML.
 *
 * A body counts as Markdown when it carries no editor HTML tag and either has
 * a Markdown mark or spans several lines (the rich editor never saves a bare
 * newline — it writes `<div>` / `<br>`). An empty body or one plain line stays
 * with the rich editor, which is how a note written on the desktop starts.
 * An entity reference such as `&amp;` is valid in Markdown too, so it only
 * keeps a body with the rich editor when no Markdown mark is present.
 *
 * @param content - The note body / ノート本文
 * @returns true when it should be rendered as Markdown / Markdown として描画するなら true
 */
export function isMarkdownNoteContent(content: string): boolean {
  if (content.trim() === '') return false;
  const prose = withoutCode(content);
  if (EDITOR_HTML_TAG.test(prose)) return false;
  const hasMarkdownMark = MARKDOWN_SIGNALS.some((signal) => signal.test(content));
  if (hasMarkdownMark) return true;
  // NOTE: Without a mark, an entity stays the conservative "editor HTML" signal
  // it was before, even across several lines.
  if (HTML_ENTITY.test(prose)) return false;
  return content.trim().includes('\n');
}

/**
 * Removes tags until none are left. Loops because one pass is not a fixed
 * point (`<scr<x>ipt>` rebuilds a tag); the result is only rendered as a
 * React text child, so this is about the preview reading correctly.
 */
function stripTags(html: string): string {
  let out = html;
  let previous: string;
  do {
    previous = out;
    out = out.replace(/<[^>]*>/g, '');
  } while (out !== previous);
  return out.trim();
}

function stripMarkdown(markdown: string): string {
  return (
    markdown
      // Diagram source is not prose; a preview of `flowchart TD` reads as noise.
      .replace(
        /^ {0,3}(`{3,}|~{3,})\s*mermaid[^\n]*\n[\s\S]*?(^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gim,
        '',
      )
      .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*$/gm, '')
      .replace(/^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{0,}:?\s*$/gm, '')
      .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
      .replace(/^ {0,3}#{1,6}\s+/gm, '')
      .replace(/^ {0,3}>\s?/gm, '')
      .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, '')
      .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * The body as one line of plain text, for list and chip previews.
 *
 * @param content - The note body, Markdown or editor HTML / ノート本文（Markdown またはエディタの HTML）
 * @returns Text without Markdown marks or tags / 記号やタグを除いた文章
 */
export function noteContentToPlainText(content: string): string {
  return isMarkdownNoteContent(content) ? stripMarkdown(content) : stripTags(content);
}
