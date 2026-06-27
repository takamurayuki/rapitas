/**
 * code-block-cursor
 *
 * Caret offset helpers for contenteditable code blocks that contain nested
 * highlight `<span>` elements. Maps between a flat character offset and a DOM
 * Range so the caret survives innerHTML re-highlighting.
 */

/**
 * Return the caret's character offset within `el`'s entire text content.
 * Works correctly when `el` contains nested `<span>` elements (highlighted code).
 *
 * @param el - The contenteditable element containing the caret / キャレットを含む要素
 * @returns Character offset from the start of el / 開始からの文字オフセット
 */
export function getCursorOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/**
 * Restore the caret to a character offset within `el`.
 * Works correctly when `el` contains nested `<span>` elements (highlighted code).
 *
 * @param el - The contenteditable element / キャレットを設定する要素
 * @param offset - Character offset from the start of el / 設定する文字オフセット
 */
export function setCursorOffset(el: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let remaining = offset;
  let placed = false;

  function walk(node: Node): void {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length;
      if (remaining <= len) {
        range.setStart(node, remaining);
        range.collapse(true);
        placed = true;
      } else {
        remaining -= len;
      }
    } else {
      for (const child of Array.from(node.childNodes)) {
        walk(child);
        if (placed) return;
      }
    }
  }

  walk(el);
  if (!placed) {
    // Offset was past the end — place caret at the very end
    range.selectNodeContents(el);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}
