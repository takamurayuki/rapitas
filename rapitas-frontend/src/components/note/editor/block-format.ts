/**
 * block-format
 *
 * Block-level formatting for the note editor: JIRA-style paragraph/heading
 * conversion (p/h1/h2/h3), current-block detection, and heading-specific
 * Enter handling. Inline span formatting stays in formatting.ts.
 *
 * NOTE: Conversion is manual DOM surgery instead of execCommand('formatBlock')
 * — execCommand is deprecated, behaves inconsistently across browsers for
 * BR-delimited lines (which this editor produces), and is unimplemented in
 * jsdom so it could never be covered by tests.
 */
import type React from 'react';
import { focusEditorPreservingRange, isInTitleInput } from './formatting';

/** Block styles offered by the toolbar dropdown. */
export type BlockType = 'p' | 'h1' | 'h2' | 'h3';

const HEADING_TAGS: readonly string[] = ['H1', 'H2', 'H3'];

/** Tags applyBlockFormat may rewrite in place (DIV = browser default block). */
const CONVERTIBLE_TAGS: readonly string[] = ['P', 'DIV', 'H1', 'H2', 'H3'];

/** Tags that terminate an inline run when a caret line is expanded. */
const BLOCK_TAGS: readonly string[] = [
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'PRE',
  'TABLE',
  'UL',
  'OL',
  'BLOCKQUOTE',
];

function isBr(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR';
}

function isBlockElement(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.includes((node as Element).tagName);
}

/** Containers that must never be converted (diagram/code/table chrome). */
function isProtectedBlock(el: Element): boolean {
  return (
    el.classList.contains('diagram-block') ||
    el.querySelector('pre, code, table, .diagram-source') !== null
  );
}

/** Returns the direct child of `root` that contains `node`. */
function topLevelOf(node: Node, root: HTMLElement): Node {
  let n: Node = node;
  while (n.parentNode && n.parentNode !== root) n = n.parentNode;
  return n;
}

/** Resolves a range boundary to a direct child of `root`. */
function boundaryTop(container: Node, offset: number, root: HTMLElement): Node {
  if (container === root) {
    const idx = Math.min(offset, root.childNodes.length - 1);
    return root.childNodes[idx] ?? root;
  }
  return topLevelOf(container, root);
}

/** Rebuilds `el` under a new tag, moving (not cloning) all children. */
function replaceTag(el: HTMLElement, tag: BlockType): HTMLElement {
  if (el.tagName === tag.toUpperCase()) return el;
  const repl = document.createElement(tag);
  while (el.firstChild) repl.appendChild(el.firstChild);
  el.replaceWith(repl);
  return repl;
}

/**
 * Returns the block type at the current selection.
 *
 * @param root - Editor root bounding the ancestor walk / 先祖走査の境界要素
 * @returns 'h1' | 'h2' | 'h3' when the caret is inside a heading, else 'p'
 */
export function detectCurrentBlockType(root: HTMLElement | null): BlockType {
  const selection = window.getSelection();
  if (!root || !selection || selection.rangeCount === 0) return 'p';

  let node: Node | null = selection.getRangeAt(0).startContainer;
  if (!root.contains(node)) return 'p';
  while (node && node !== root) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName;
      if (HEADING_TAGS.includes(tag)) return tag.toLowerCase() as BlockType;
    }
    node = node.parentNode;
  }
  return 'p';
}

/**
 * Converts every block intersecting the current selection to `type`.
 * BR-delimited inline runs (this editor's native line format) are wrapped
 * into a real block element; existing p/div/h1-h3 blocks are re-tagged in
 * place so inline font/color spans survive. Lists, tables, code and diagram
 * blocks are left untouched.
 *
 * @param contentEl - The contentEditable editor element / エディタ要素
 * @param type - Target block type / 変換先ブロック種別
 * @returns true when at least one block was converted / 変換された場合true
 */
export function applyBlockFormat(contentEl: HTMLDivElement | null, type: BlockType): boolean {
  if (isInTitleInput()) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  if (!contentEl?.contains(range.commonAncestorContainer)) return false;
  focusEditorPreservingRange(contentEl, range);

  // Empty editor: seed a block so the chosen style applies to upcoming input.
  if (contentEl.childNodes.length === 0) {
    const block = document.createElement(type);
    block.appendChild(document.createElement('br'));
    contentEl.appendChild(block);
    const nr = document.createRange();
    nr.setStart(block, 0);
    nr.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nr);
    return true;
  }

  // Children are moved (not cloned) during conversion, so the original
  // boundary nodes can re-anchor the selection afterwards.
  const saved = {
    sc: range.startContainer,
    so: range.startOffset,
    ec: range.endContainer,
    eo: range.endOffset,
  };

  let startTop = boundaryTop(range.startContainer, range.startOffset, contentEl);
  let endTop = boundaryTop(range.endContainer, range.endOffset, contentEl);
  if (startTop === contentEl || endTop === contentEl) return false;

  // Expand inline boundaries to whole lines. The line-terminating BR after
  // the run is consumed (the created block renders its own line break); the
  // BR before the run is kept so preceding lines are untouched.
  while (
    !isBlockElement(startTop) &&
    startTop.previousSibling &&
    !isBlockElement(startTop.previousSibling) &&
    !isBr(startTop.previousSibling)
  ) {
    startTop = startTop.previousSibling;
  }
  while (
    !isBlockElement(endTop) &&
    !isBr(endTop) &&
    endTop.nextSibling &&
    !isBlockElement(endTop.nextSibling) &&
    !isBr(endTop.nextSibling)
  ) {
    endTop = endTop.nextSibling;
  }
  if (!isBlockElement(endTop) && !isBr(endTop) && endTop.nextSibling && isBr(endTop.nextSibling)) {
    endTop = endTop.nextSibling;
  }

  const nodes: Node[] = [];
  for (let n: Node | null = startTop; n; n = n.nextSibling) {
    nodes.push(n);
    if (n === endTop) break;
  }

  const created: HTMLElement[] = [];
  let run: Node[] = [];
  const flushRun = () => {
    if (run.length > 0) {
      const block = document.createElement(type);
      run[0].parentNode!.insertBefore(block, run[0]);
      run.forEach((n) => block.appendChild(n));
      created.push(block);
    }
    run = [];
  };

  for (const n of nodes) {
    if (isBr(n)) {
      flushRun();
      (n as Element).remove();
    } else if (isBlockElement(n)) {
      flushRun();
      const el = n as HTMLElement;
      if (CONVERTIBLE_TAGS.includes(el.tagName) && !isProtectedBlock(el)) {
        created.push(replaceTag(el, type));
      }
    } else {
      run.push(n);
    }
  }
  flushRun();

  try {
    const nr = document.createRange();
    nr.setStart(saved.sc, saved.so);
    nr.setEnd(saved.ec, saved.eo);
    selection.removeAllRanges();
    selection.addRange(nr);
  } catch {
    // Boundary node was consumed (e.g. caret sat on a removed BR) — fall back
    // to the start of the first converted block.
    if (created.length > 0) {
      const nr = document.createRange();
      nr.selectNodeContents(created[0]);
      nr.collapse(true);
      selection.removeAllRanges();
      selection.addRange(nr);
    }
  }
  return created.length > 0;
}

/**
 * Handles Enter inside a heading. At the END of a heading the next line
 * becomes a normal paragraph (JIRA convention); mid-heading it falls through
 * so the browser splits the heading normally.
 *
 * @param e - Keydown event (Enter) / Enterキーイベント
 * @param contentRef - Editor ref / エディタ要素のref
 * @param onContentChange - Marks the note dirty / ノートをdirtyにする
 * @returns true when the event was fully handled / 処理を完了した場合true
 */
export function handleHeadingEnter(
  e: React.KeyboardEvent<HTMLDivElement>,
  contentRef: React.RefObject<HTMLDivElement | null>,
  onContentChange: () => void,
): boolean {
  const root = contentRef.current;
  const selection = window.getSelection();
  if (!root || !selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  if (!range.collapsed || !root.contains(range.startContainer)) return false;

  let node: Node | null = range.startContainer;
  let heading: HTMLElement | null = null;
  while (node && node !== root) {
    if (node.nodeType === Node.ELEMENT_NODE && HEADING_TAGS.includes((node as Element).tagName)) {
      heading = node as HTMLElement;
      break;
    }
    node = node.parentNode;
  }
  if (!heading) return false;

  // Only take over at the very end of the heading (ZWSP anchors don't count).
  const tail = document.createRange();
  tail.setStart(range.startContainer, range.startOffset);
  tail.setEndAfter(heading.lastChild ?? heading);
  if (tail.toString().replace(/​/g, '') !== '') return false;

  e.preventDefault();
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  heading.after(p);

  const nr = document.createRange();
  nr.setStart(p, 0);
  nr.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nr);
  onContentChange();
  return true;
}
