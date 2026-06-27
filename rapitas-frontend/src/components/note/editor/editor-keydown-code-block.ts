/**
 * editor-keydown-code-block
 *
 * Code-block deletion guards for the note editor. Detects when the caret is
 * inside, or adjacent to, a code block so the outer editor can skip or cancel
 * key handling and never delete a code block via the keyboard.
 */
import type React from 'react';

/**
 * Returns true when the caret is anywhere inside a code block container.
 * Used to skip outer-editor key handling so the code element's own onkeydown
 * (Enter/Tab/Backspace/Delete) runs unimpeded.
 */
export function isCursorInCodeBlock(contentRef: React.RefObject<HTMLDivElement | null>): boolean {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  let node: Node | null = sel.getRangeAt(0).startContainer;
  while (node && node !== contentRef.current) {
    if ((node as HTMLElement).dataset?.rapitasCodeBlock === '1') return true;
    node = node.parentNode;
  }
  return false;
}

/**
 * Returns true when the current non-collapsed selection spans a code block.
 * Keyboard deletion of a code block is never allowed — use the trash button.
 */
export function selectionCoversCodeBlock(range: Range): boolean {
  if (range.collapsed) return false;
  return !!range.cloneContents().querySelector('[data-rapitas-code-block]');
}

/**
 * Returns true when the nearest block ancestor of the caret (a direct child of
 * the editor container) has a code block as its previous sibling.
 * Pressing Backspace in this position would otherwise merge into the code block.
 */
export function prevSiblingIsCodeBlock(
  range: Range,
  contentRef: React.RefObject<HTMLDivElement | null>,
): boolean {
  let node: Node | null = range.startContainer;
  while (node && node.parentNode !== contentRef.current) {
    node = node.parentNode;
  }
  if (!node) return false;
  const prev = (node as Element).previousElementSibling;
  return prev?.getAttribute('data-rapitas-code-block') === '1';
}

/**
 * Returns true when the nearest block ancestor of the caret has a code block
 * as its next sibling.  Pressing Delete here would otherwise eat into it.
 */
export function nextSiblingIsCodeBlock(
  range: Range,
  contentRef: React.RefObject<HTMLDivElement | null>,
): boolean {
  let node: Node | null = range.startContainer;
  while (node && node.parentNode !== contentRef.current) {
    node = node.parentNode;
  }
  if (!node) return false;
  const next = (node as Element).nextElementSibling;
  return next?.getAttribute('data-rapitas-code-block') === '1';
}
