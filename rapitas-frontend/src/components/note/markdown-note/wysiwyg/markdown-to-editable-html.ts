/**
 * markdown-to-editable-html
 *
 * Turns a Markdown note into the HTML the WYSIWYG surface starts from, and
 * reports whether writing that HTML back gives the same Markdown.
 * Uses a plain react-markdown render (GFM, line breaks, the allowed inline
 * forms) rather than MarkdownView, whose emoji icons, heading decoration and
 * drawn diagrams would not survive the trip back to Markdown.
 * Not responsible for editing; see WysiwygNoteSurface.tsx.
 */
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import remarkNoteInlineHtml from '../inline-html/remark-note-inline-html';
import { domToMarkdown } from '../html-to-markdown';

const PLUGINS = [remarkGfm, remarkBreaks, remarkNoteInlineHtml];

/**
 * The editable HTML for a Markdown note.
 *
 * Must be called from an event handler, not during render or an effect:
 * it renders synchronously into a detached element (flushSync), which
 * avoids react-dom/server in the client bundle.
 *
 * @param markdown - The note body / ノート本文（Markdown）
 * @returns Sanitized HTML for the surface / 編集面に置くサニタイズ済み HTML
 */
export function markdownToEditableHtml(markdown: string): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    flushSync(() => {
      root.render(createElement(ReactMarkdown, { remarkPlugins: PLUGINS }, markdown));
    });
    // GFM renders task boxes disabled; on the surface they are clicked.
    for (const box of Array.from(host.querySelectorAll('input[type="checkbox"]'))) {
      box.removeAttribute('disabled');
    }
    return DOMPurify.sanitize(host.innerHTML);
  } finally {
    root.unmount();
  }
}

/** Line endings and trailing space differences do not count as a change. */
function normalize(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/**
 * Whether the visual editor would write this body back differently
 * (`*` lists as `-`, a footnote, raw HTML …), so the user can be told
 * before anything is rewritten.
 *
 * @param markdown - The note body / ノート本文
 * @param html - Its editable HTML / 編集用 HTML
 * @returns true when the round trip changes the text / 往復で本文が変わるなら true
 */
export function roundTripChanges(markdown: string, html: string): boolean {
  const scratch = document.createElement('div');
  scratch.innerHTML = html;
  return normalize(domToMarkdown(scratch)) !== normalize(markdown);
}
