/**
 * editor-keydown-enter
 *
 * Enter key handling for the note editor: escapes highlight/border spans but
 * continues text-color and font/size spans onto the new line, preserving
 * trailing content. Does NOT handle Backspace, Delete, or code-block guards.
 */
import type React from 'react';
import type { EditorRefs } from './editor-keydown.types';

/**
 * Handles Enter key: escapes highlight/border spans, but continues text color
 * and font-family/font-size spans onto the new line.
 */
export function handleEnter(
  e: React.KeyboardEvent<HTMLDivElement>,
  refs: EditorRefs,
  onContentChange: () => void,
): void {
  const { contentRef, activeColorSpanRef, selectedTextColorRef } = refs;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  let node: Node | null = range.startContainer;

  let styledSpan: HTMLElement | null = null;
  let isTextColorSpan = false;
  let isFontSpan = false;
  while (node && node !== contentRef.current) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'SPAN') {
      const el = node as HTMLElement;
      if (el.style.backgroundColor || el.style.background || el.style.borderLeft) {
        styledSpan = el;
        break;
      }
      if (el.style.color) {
        styledSpan = el;
        isTextColorSpan = true;
        break;
      }
      // NOTE: Without this, Enter inside a font span fell through to the
      // browser default, which starts the new line OUTSIDE the span — the
      // chosen font silently reverted to the body default (Arial).
      if (el.style.fontFamily || el.style.fontSize) {
        styledSpan = el;
        isFontSpan = true;
        break;
      }
    }
    node = node.parentNode;
  }

  if (!styledSpan && selectedTextColorRef.current) {
    e.preventDefault();

    const br = document.createElement('br');
    range.insertNode(br);

    const newColorSpan = document.createElement('span');
    newColorSpan.style.color = selectedTextColorRef.current;
    newColorSpan.textContent = '\u200B';
    activeColorSpanRef.current = newColorSpan;

    if (br.nextSibling) {
      br.parentNode!.insertBefore(newColorSpan, br.nextSibling);
    } else {
      br.parentNode!.appendChild(newColorSpan);
    }

    const newRange = document.createRange();
    newRange.setStart(newColorSpan.firstChild!, 1);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    onContentChange();
    return;
  }

  if (!styledSpan) return;

  e.preventDefault();

  const afterRange = document.createRange();
  afterRange.setStart(range.startContainer, range.startOffset);
  afterRange.setEndAfter(styledSpan.lastChild || styledSpan);
  const trailing = afterRange.extractContents();

  const hasTrailing = trailing.textContent && trailing.textContent.length > 0;
  let trailingSpan: HTMLElement | null = null;
  if (hasTrailing) {
    trailingSpan = styledSpan.cloneNode(false) as HTMLElement;
    trailingSpan.appendChild(trailing);
  }

  const br = document.createElement('br');
  styledSpan.parentNode!.insertBefore(br, styledSpan.nextSibling);

  if (trailingSpan) {
    br.parentNode!.insertBefore(trailingSpan, br.nextSibling);
  }

  const newRange = document.createRange();
  if (isTextColorSpan || isFontSpan || selectedTextColorRef.current) {
    const newColorSpan = styledSpan.cloneNode(false) as HTMLElement;

    if (selectedTextColorRef.current && !isTextColorSpan) {
      newColorSpan.style.color = selectedTextColorRef.current;
    }

    newColorSpan.textContent = '\u200B';
    // NOTE: Only color-carrying spans register as the active color anchor \u2014
    // pure font/size spans are cleaned up by handleEditorInput's ZWSP logic
    // and must not enter the color-persistence tracking.
    if (isTextColorSpan || selectedTextColorRef.current) {
      activeColorSpanRef.current = newColorSpan;
    }

    if (trailingSpan) {
      br.parentNode!.insertBefore(newColorSpan, trailingSpan);
    } else {
      br.parentNode!.insertBefore(newColorSpan, br.nextSibling);
    }

    newRange.setStart(newColorSpan.firstChild!, 1);
    newRange.collapse(true);
  } else {
    // NOTE: For background/highlight spans, always place cursor after <br> so
    // the new line starts unstyled. trailingSpan (if any) stays in place to
    // preserve content that was after the cursor, but the cursor itself sits
    // between <br> and it — outside any styled span.
    newRange.setStartAfter(br);
    newRange.collapse(true);
  }

  selection.removeAllRanges();
  selection.addRange(newRange);

  if (!styledSpan.textContent) {
    styledSpan.remove();
  }

  onContentChange();
}
