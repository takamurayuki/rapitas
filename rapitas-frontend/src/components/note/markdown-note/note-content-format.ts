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
const EDITOR_HTML_TAG =
  /<\/?(p|div|br|span|font|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|pre|code|blockquote|strong|b|em|i|u|s|strike|a|img|hr|mark)(\s[^<>]*)?\/?>/i;
const HTML_ENTITY = /&(nbsp|amp|lt|gt|quot|#\d+|#x[0-9a-f]+);/i;

const FENCE_BLOCK = /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(^ {0,3}\1[`~]*[ \t]*$|(?![\s\S]))/gm;
const INLINE_CODE = /`[^`\n]+`/g;

// Line starts and inline marks that only Markdown gives a meaning to.
const MARKDOWN_SIGNALS = [
  /^ {0,3}#{1,6}\s/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+[.)]\s+\S/m,
  /^ {0,3}>/m,
  /^\s*\|.*\|\s*$/m,
  /^ {0,3}(`{3,}|~{3,})/m,
  /\*\*[^*\n]+\*\*/,
  /\[[^\]\n]+\]\([^)\s]+\)/,
  /`[^`\n]+`/,
];

function withoutCode(content: string): string {
  return content.replace(FENCE_BLOCK, '').replace(INLINE_CODE, '');
}

/**
 * Whether a note body is Markdown rather than the rich editor's HTML.
 *
 * A body counts as Markdown when it carries no editor HTML and either has a
 * Markdown mark or spans several lines (the rich editor never saves a bare
 * newline — it writes `<div>` / `<br>`). An empty body or one plain line stays
 * with the rich editor, which is how a note written on the desktop starts.
 *
 * @param content - The note body / ノート本文
 * @returns true when it should be rendered as Markdown / Markdown として描画するなら true
 */
export function isMarkdownNoteContent(content: string): boolean {
  if (content.trim() === '') return false;
  const prose = withoutCode(content);
  if (EDITOR_HTML_TAG.test(prose) || HTML_ENTITY.test(prose)) return false;
  if (content.trim().includes('\n')) return true;
  return MARKDOWN_SIGNALS.some((signal) => signal.test(content));
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
