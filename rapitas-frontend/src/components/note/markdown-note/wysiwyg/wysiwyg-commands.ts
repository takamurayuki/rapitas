/**
 * wysiwyg-commands
 *
 * The editing commands of the note WYSIWYG surface: wrapping the selection in
 * an allowed inline form (colour, highlight, size), the browser's own marks
 * and blocks, a checklist, and inserting code, diagram, table and link.
 * Every element made here is one `domToMarkdown` writes back as Markdown or
 * as an allowed inline form, so the saved body stays Markdown.
 * Not responsible for the toolbar UI; see WysiwygToolbar.tsx.
 */
import { createTableNode, type TableShape } from '../../editor/table';
import type { HeadingNamer } from '../../editor/table-ops';
import { linkRange, urlFromPastedText } from '../../editor/inline-link';
import { applyBlockFormat } from '../../editor/block-format';
import { NOTE_FONT_SIZE_MAX, NOTE_FONT_SIZE_MIN } from '../inline-html';
import { insertAfterBlock, rangeIn } from './wysiwyg-blocks';

export { toggleChecklist } from './wysiwyg-blocks';

/** The marks the browser applies itself (Ctrl/Cmd+B, I, U and strike). */
export type InlineMark = 'bold' | 'italic' | 'underline' | 'strikeThrough';

/** Block shapes the browser converts with formatBlock / list commands. */
export type BlockCommand = 'p' | 'h1' | 'h2' | 'h3' | 'blockquote' | 'ul' | 'ol';

const HEX6 = /^#[0-9a-f]{6}$/i;

/**
 * Whether a colour is the only kind a note may store: six-digit #RRGGBB.
 *
 * @param value - The colour typed or picked / 入力・選択された色
 * @returns true for #RRGGBB / #RRGGBB なら true
 */
export function isNoteHexColour(value: string): boolean {
  return HEX6.test(value.trim());
}

function selectContents(el: Node): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Wrap a non-empty selection inside the surface in `el`. */
function wrapSelection(root: HTMLElement, el: HTMLElement): boolean {
  const range = rangeIn(root);
  if (!range || range.collapsed) return false;
  // extractContents (not surroundContents) so a range that crosses element
  // boundaries — part of a bold run, say — is still wrapped whole.
  el.appendChild(range.extractContents());
  range.insertNode(el);
  selectContents(el);
  return true;
}

function styled(tag: 'span' | 'mark', style: string): HTMLElement {
  const el = document.createElement(tag);
  // setAttribute keeps the canonical spelling; el.style would turn the hex into rgb().
  el.setAttribute('style', style);
  return el;
}

/**
 * Colour the selected text.
 *
 * @param root - The surface / 編集面
 * @param hex - #RRGGBB / 文字色
 * @returns true when applied / 適用したら true
 */
export function applyTextColor(root: HTMLElement, hex: string): boolean {
  if (!isNoteHexColour(hex)) return false;
  return wrapSelection(root, styled('span', `color:${hex.trim().toUpperCase()}`));
}

/**
 * Highlight the selected text.
 *
 * @param root - The surface / 編集面
 * @param hex - #RRGGBB / ハイライト色
 * @returns true when applied / 適用したら true
 */
export function applyHighlight(root: HTMLElement, hex: string): boolean {
  if (!isNoteHexColour(hex)) return false;
  return wrapSelection(root, styled('mark', `background-color:${hex.trim().toUpperCase()}`));
}

/**
 * Set the font size of the selected text.
 *
 * @param root - The surface / 編集面
 * @param px - Size in px, 8..72 / 文字サイズ（px）
 * @returns true when applied / 適用したら true
 */
export function applyFontSize(root: HTMLElement, px: number): boolean {
  if (!Number.isInteger(px) || px < NOTE_FONT_SIZE_MIN || px > NOTE_FONT_SIZE_MAX) return false;
  return wrapSelection(root, styled('span', `font-size:${px}px`));
}

/**
 * Apply a mark the browser owns (bold, italic, underline, strike).
 *
 * @param root - The surface / 編集面
 * @param mark - Which mark / 装飾の種類
 * @returns Whether the browser applied it / 適用されたか
 */
export function applyInlineMark(root: HTMLElement, mark: InlineMark): boolean {
  if (!rangeIn(root)) return false;
  return document.execCommand(mark, false);
}

/**
 * Turn the current block into a paragraph, heading, quote or list.
 *
 * @param root - The surface / 編集面
 * @param block - Target shape / 変換先
 * @returns Whether the browser applied it / 適用されたか
 */
export function applyBlock(root: HTMLDivElement, block: BlockCommand): boolean {
  if (!rangeIn(root)) return false;
  // Paragraph and headings go through the old editor's block formatter, which
  // re-tags blocks in place so the colour and size spans inside survive.
  if (block === 'p' || block === 'h1' || block === 'h2' || block === 'h3') {
    return applyBlockFormat(root, block);
  }
  if (block === 'ul') return document.execCommand('insertUnorderedList', false);
  if (block === 'ol') return document.execCommand('insertOrderedList', false);
  return document.execCommand('formatBlock', false, block);
}

function emptyParagraph(): HTMLParagraphElement {
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  return p;
}

function insertCode(root: HTMLElement, language: string, source: string): boolean {
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  if (/^[\w-]+$/.test(language)) code.className = `language-${language}`;
  code.textContent = source;
  pre.appendChild(code);
  const frag = document.createDocumentFragment();
  frag.append(pre, emptyParagraph());
  insertAfterBlock(root, frag);
  return true;
}

/**
 * Insert a code block of a language.
 *
 * @param root - The surface / 編集面
 * @param language - Language id (e.g. `typescript`), or '' / 言語（空なら指定なし）
 * @returns true when inserted / 挿入したら true
 */
export function insertCodeBlock(root: HTMLElement, language: string): boolean {
  return insertCode(root, language, '');
}

/**
 * Insert a Mermaid diagram (a mermaid fence) from a template's source.
 *
 * @param root - The surface / 編集面
 * @param source - Mermaid source / Mermaid のソース
 * @returns true when inserted / 挿入したら true
 */
export function insertDiagram(root: HTMLElement, source: string): boolean {
  return insertCode(root, 'mermaid', source);
}

/**
 * Insert a table of a shape after the current block.
 *
 * @param root - The surface / 編集面
 * @param shape - Body rows and columns / 本文の行数と列数
 * @param headingName - Names each heading / 見出しの命名
 * @returns true when inserted / 挿入したら true
 */
export function insertTable(
  root: HTMLElement,
  shape: TableShape,
  headingName: HeadingNamer,
): boolean {
  insertAfterBlock(root, createTableNode(shape, headingName));
  return true;
}

/**
 * Make the selected text a link to an http(s) URL.
 *
 * @param root - The surface / 編集面
 * @param url - The URL typed / 入力された URL
 * @returns true when linked / リンクにしたら true
 */
export function insertLink(root: HTMLElement, url: string): boolean {
  const range = rangeIn(root);
  const href = urlFromPastedText(url);
  if (!range || !href) return false;
  return linkRange(range, href) !== null;
}

/**
 * A copy of the selection's range when it lies in the surface, kept while a
 * toolbar field (URL, colour code) has the focus.
 *
 * @param root - The surface / 編集面
 * @returns The range, or null / 範囲、編集面の外なら null
 */
export function saveSelection(root: HTMLElement): Range | null {
  return rangeIn(root)?.cloneRange() ?? null;
}

/**
 * Put a saved range back as the selection.
 *
 * @param range - From saveSelection / saveSelection で得た範囲
 */
export function restoreSelection(range: Range | null): void {
  const selection = window.getSelection();
  if (!range || !selection) return;
  selection.removeAllRanges();
  selection.addRange(range);
}
