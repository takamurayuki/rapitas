import type React from 'react';

interface ColorRefs {
  contentRef: React.RefObject<HTMLDivElement | null>;
  activeColorSpanRef: React.MutableRefObject<HTMLSpanElement | null>;
  selectedTextColorRef: React.MutableRefObject<string | null>;
}

/**
 * Extract the last typed character from a text node and wrap it in a color span.
 * This is used when the user types outside of an existing color span but has
 * a persistent text color selected.
 */
function moveLastCharToColorSpan(container: Node, refs: ColorRefs): void {
  const { activeColorSpanRef, selectedTextColorRef } = refs;

  if (container.nodeType === Node.TEXT_NODE && container.textContent) {
    const text = container.textContent;
    const newText = text.slice(0, -1);
    container.textContent = newText;

    const newSpan = document.createElement('span');
    newSpan.style.color = selectedTextColorRef.current!;
    newSpan.textContent = text.slice(-1);
    activeColorSpanRef.current = newSpan;

    const currentSelection = window.getSelection();
    if (currentSelection && currentSelection.rangeCount > 0) {
      const currentRange = currentSelection.getRangeAt(0);

      currentRange.insertNode(newSpan);

      const newRange = document.createRange();
      newRange.setStartAfter(newSpan);
      newRange.collapse(true);
      currentSelection.removeAllRanges();
      currentSelection.addRange(newRange);
    }
  }
}

/**
 * Handles the onInput event for the contentEditable editor.
 * Manages color span tracking and auto-wrapping of newly typed characters
 * in a color span when a persistent text color is selected.
 */
export function handleEditorInput(
  e: React.FormEvent<HTMLDivElement>,
  refs: ColorRefs,
  onContentChange: () => void,
): void {
  const { contentRef, activeColorSpanRef, selectedTextColorRef } = refs;

  onContentChange();

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  const container = range.startContainer;

  // Check if cursor is inside a color span
  let node: Node | null = container;
  let isInColorSpan = false;

  while (node && node !== contentRef.current) {
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      (node as HTMLElement).tagName === 'SPAN' &&
      (node as HTMLElement).style.color
    ) {
      isInColorSpan = true;
      break;
    }
    node = node.parentNode;
  }

  if (activeColorSpanRef.current) {
    const activeSpan = activeColorSpanRef.current;

    // Remove leading zero-width space once real content is typed
    if (
      activeSpan.textContent &&
      activeSpan.textContent.length > 1 &&
      activeSpan.textContent.startsWith('\u200B')
    ) {
      activeSpan.textContent = activeSpan.textContent.substring(1);
    }

    // Check if cursor is still inside the active span
    let checkNode: Node | null = container;
    let isInsideActiveSpan = false;
    while (checkNode && checkNode !== contentRef.current) {
      if (checkNode === activeColorSpanRef.current) {
        isInsideActiveSpan = true;
        break;
      }
      checkNode = checkNode.parentNode;
    }

    // Cursor moved outside the active span
    if (!isInsideActiveSpan) {
      activeColorSpanRef.current = null;

      if (selectedTextColorRef.current && !isInColorSpan) {
        const inputTarget = e.target as HTMLElement;
        const lastChar = inputTarget.textContent?.slice(-1) || '';
        if (lastChar && lastChar !== '\n' && lastChar !== '\r') {
          moveLastCharToColorSpan(container, refs);
        }
      }
    }
  } else if (selectedTextColorRef.current && !isInColorSpan) {
    const inputTarget = e.target as HTMLElement;
    const lastChar = inputTarget.textContent?.slice(-1) || '';
    if (lastChar && lastChar !== '\n' && lastChar !== '\r') {
      moveLastCharToColorSpan(container, refs);
    }
  }
}

/**
 * After a Backspace/Delete keydown, ensure a zero-width color span is
 * re-created if the cursor ended up outside any color span.
 */
export function handleDeleteColorPersistence(refs: ColorRefs): void {
  const { contentRef, activeColorSpanRef, selectedTextColorRef } = refs;

  if (!selectedTextColorRef.current) return;

  setTimeout(() => {
    const newSelection = window.getSelection();
    if (!newSelection || newSelection.rangeCount === 0) return;

    const newRange = newSelection.getRangeAt(0);
    if (!newRange.collapsed) return;

    const newContainer = newRange.startContainer;

    let checkNode: Node | null = newContainer;
    let isInColorSpan = false;

    while (checkNode && checkNode !== contentRef.current) {
      if (
        checkNode.nodeType === Node.ELEMENT_NODE &&
        (checkNode as HTMLElement).tagName === 'SPAN' &&
        (checkNode as HTMLElement).style.color
      ) {
        isInColorSpan = true;
        break;
      }
      checkNode = checkNode.parentNode;
    }

    if (!isInColorSpan && selectedTextColorRef.current) {
      const newSpan = document.createElement('span');
      newSpan.style.color = selectedTextColorRef.current;
      newSpan.textContent = '\u200B';
      activeColorSpanRef.current = newSpan;

      newRange.insertNode(newSpan);

      const cursorRange = document.createRange();
      cursorRange.setStart(newSpan.firstChild!, 1);
      cursorRange.collapse(true);
      newSelection.removeAllRanges();
      newSelection.addRange(cursorRange);
    }
  }, 0);
}
