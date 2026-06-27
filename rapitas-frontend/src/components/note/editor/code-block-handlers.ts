/**
 * code-block-handlers
 *
 * Keyboard, paste, and blur-highlight interaction handlers for the editable
 * `<code>` element inside a code block. Owns no DOM construction — it only wires
 * behaviour onto an element supplied by the DOM builder.
 */

import { highlightCode } from './code-block-highlight';
import {
  getCurrentLine,
  getIndentation,
  getIndentString,
  shouldAutoIndent,
} from './code-block-indent';

/** Auto-pair characters for bracket/quote completion. */
const AUTO_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`',
};

/**
 * Attach keyboard interaction handlers to the editable code element.
 * Handles Enter (auto-indent), Tab (insert indent), Backspace guard, and auto-pairs.
 *
 * NOTE: The Backspace guard uses a preRange character-offset check so that it
 * works correctly when the element contains highlight `<span>` children — a simple
 * `range.startOffset === 0` check would fail inside nested spans.
 *
 * @param codeElement - The contenteditable code element / 編集可能なコード要素
 * @param language - Language identifier for indent rules / インデントルール用言語識別子
 */
export function attachKeyHandlers(codeElement: HTMLElement, language: string): void {
  codeElement.onkeydown = (e) => {
    const keyboardEvent = e as KeyboardEvent;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    // NOTE: Prevent Backspace from exiting the code block when the caret is at
    // character offset 0 in the element (regardless of span nesting depth).
    if (keyboardEvent.key === 'Backspace') {
      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        const preRange = document.createRange();
        preRange.selectNodeContents(codeElement);
        preRange.setEnd(range.startContainer, range.startOffset);
        if (preRange.toString().length === 0) {
          e.preventDefault();
          return;
        }
      }
    }

    // Enter key — insert newline with auto-indent
    if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
      e.preventDefault();
      const range = selection.getRangeAt(0);
      // Pass codeElement so getCurrentLine works inside highlighted spans
      const currentLine = getCurrentLine(range, codeElement);
      const indent = getIndentation(currentLine);
      const increaseIndent = shouldAutoIndent(currentLine, language);

      const insertStr = '\n' + indent + (increaseIndent ? getIndentString(language) : '');

      // NOTE: execCommand('insertText', '\n') is unreliable in Chromium on
      // white-space:pre contenteditable — the '\n' is sometimes not rendered as
      // a visible line break.  Insert a real Text node via the Range API instead.
      if (!range.collapsed) range.deleteContents();
      const newlineNode = document.createTextNode(insertStr);
      range.insertNode(newlineNode);
      const newRange = document.createRange();
      newRange.setStartAfter(newlineNode);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }

    // Tab key — insert language-appropriate indent
    if (keyboardEvent.key === 'Tab') {
      e.preventDefault();
      const range = selection.getRangeAt(0);
      if (!range.collapsed) range.deleteContents();
      const tabNode = document.createTextNode(getIndentString(language));
      range.insertNode(tabNode);
      const newRange = document.createRange();
      newRange.setStartAfter(tabNode);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }

    // Auto-close brackets and quotes
    if (AUTO_PAIRS[keyboardEvent.key as string]) {
      e.preventDefault();
      const closing = AUTO_PAIRS[keyboardEvent.key];
      const range = selection.getRangeAt(0);

      if (!range.collapsed) {
        const selectedText = range.toString();
        document.execCommand('insertText', false, keyboardEvent.key + selectedText + closing);
        const newRange = document.createRange();
        const textNode = range.startContainer;
        if (textNode.nodeType === Node.TEXT_NODE) {
          newRange.setStart(textNode, range.startOffset + 1 + selectedText.length);
          newRange.setEnd(textNode, range.startOffset + 1 + selectedText.length);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      } else {
        document.execCommand('insertText', false, keyboardEvent.key + closing);
        const newRange = document.createRange();
        const textNode = range.startContainer;
        if (textNode.nodeType === Node.TEXT_NODE) {
          const offset = range.startOffset + 1;
          newRange.setStart(textNode, offset);
          newRange.setEnd(textNode, offset);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      }
    }
  };
}

/**
 * Attach the paste handler that strips HTML formatting from pasted content.
 * Without this, pasting from an IDE (e.g. VS Code) inserts rich-text HTML that
 * carries the source editor's background-color/inline styles, causing white
 * patches to appear inside the dark code block.
 *
 * @param codeElement - The contenteditable code element / 編集可能なコード要素
 */
export function attachPasteHandler(codeElement: HTMLElement): void {
  codeElement.onpaste = (e) => {
    e.preventDefault();
    const plain = e.clipboardData?.getData('text/plain') ?? '';
    if (!plain) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) range.deleteContents();
    const textNode = document.createTextNode(plain);
    range.insertNode(textNode);
    const newRange = document.createRange();
    newRange.setStartAfter(textNode);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  };
}

/**
 * Attach the blur handler that applies syntax highlighting after the user
 * finishes editing.
 *
 * NOTE: We do NOT convert to plain text on focus.  Doing so requires a
 * programmatic `sel.removeAllRanges / addRange` call which:
 *   (a) Suppresses the cursor-blink animation in Chromium until the next user
 *       interaction, making the caret invisible.
 *   (b) Races with `mouseup` in the click-event sequence (mousedown → focus →
 *       mouseup).  `getCursorOffset` reads position 0 if called before the
 *       browser commits the cursor from mousedown, so `setCursorOffset(el, 0)`
 *       jumps the caret to the start — causing Backspace to delete from there.
 *
 * Without an onfocus conversion the browser places the caret naturally inside
 * whatever span the user clicked on.  All key handlers (Backspace guard, Enter,
 * getCurrentLine) use `preRange.toString().length` which is span-aware and works
 * correctly without touching `innerHTML`.
 *
 * @param codeElement - The contenteditable code element / 編集可能なコード要素
 * @param language - Language identifier / 言語識別子
 */
export function attachHighlightHandlers(codeElement: HTMLElement, language: string): void {
  codeElement.onfocus = null; // explicitly clear in case normalizeCodeBlocks re-runs

  codeElement.onblur = () => {
    const plain = codeElement.textContent ?? '';
    if (plain) {
      codeElement.innerHTML = highlightCode(plain, language);
    }
  };
}
