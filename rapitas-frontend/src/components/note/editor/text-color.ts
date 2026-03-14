import type React from 'react';
import { isInTitleInput } from './formatting';

interface TextColorRefs {
  contentRef: React.RefObject<HTMLDivElement | null>;
  activeColorSpanRef: React.MutableRefObject<HTMLSpanElement | null>;
  selectedTextColorRef: React.MutableRefObject<string | null>;
}

interface TextColorCallbacks {
  setCurrentTextColor: (v: string) => void;
  setShowTextColorPicker: (v: boolean) => void;
  handleContentChange: () => void;
}

/** Place cursor at the end of the editor content */
function setCursorToEnd(
  sel: Selection,
  contentEl: HTMLDivElement | null,
): void {
  const newRange = document.createRange();
  const lastChild = contentEl?.lastChild;
  if (lastChild) {
    if (lastChild.nodeType === Node.TEXT_NODE) {
      newRange.setStart(lastChild, lastChild.textContent?.length || 0);
    } else {
      newRange.setStartAfter(lastChild);
    }
  } else {
    newRange.setStart(contentEl!, 0);
  }
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

/** Handle text color when there is no selection at all */
function applyTextColorNoSelection(
  color: string,
  refs: TextColorRefs,
  callbacks: TextColorCallbacks,
): void {
  const { contentRef, activeColorSpanRef, selectedTextColorRef } = refs;
  const { handleContentChange } = callbacks;

  let shouldFocus = false;
  let savedRange: Range | null = null;

  const currentSelection = window.getSelection();
  if (currentSelection && currentSelection.rangeCount > 0) {
    savedRange = currentSelection.getRangeAt(0).cloneRange();
  }

  if (
    contentRef.current &&
    !contentRef.current.contains(document.activeElement)
  ) {
    shouldFocus = true;
  }

  if (shouldFocus && contentRef.current) {
    contentRef.current.focus();
    requestAnimationFrame(() => {
      const newSelection = window.getSelection();
      if (newSelection) {
        if (savedRange) {
          try {
            newSelection.removeAllRanges();
            newSelection.addRange(savedRange);
          } catch {
            setCursorToEnd(newSelection, contentRef.current);
          }
        } else {
          setCursorToEnd(newSelection, contentRef.current);
        }
      }
    });
    return;
  }

  const processColorApplication = () => {
    const finalSelection = window.getSelection();
    if (finalSelection && finalSelection.rangeCount > 0) {
      const range = finalSelection.getRangeAt(0);

      if (activeColorSpanRef.current) {
        const oldSpan = activeColorSpanRef.current;
        if (oldSpan.textContent === '\u200B' || oldSpan.textContent === '') {
          oldSpan.remove();
        }
      }

      const span = document.createElement('span');
      span.style.color = color;
      span.textContent = '\u200B';
      activeColorSpanRef.current = span;

      const currentContainer = range.startContainer;
      const currentOffset = range.startOffset;

      if (
        currentContainer.nodeType === Node.TEXT_NODE &&
        currentContainer.parentNode
      ) {
        const textNode = currentContainer as Text;
        const parent = textNode.parentNode;
        const beforeText =
          textNode.textContent?.substring(0, currentOffset) || '';
        const afterText = textNode.textContent?.substring(currentOffset) || '';

        textNode.textContent = beforeText;

        if (afterText) {
          const afterTextNode = document.createTextNode(afterText);
          parent?.insertBefore(afterTextNode, textNode.nextSibling);
          parent?.insertBefore(span, afterTextNode);
        } else {
          if (textNode.nextSibling) {
            parent?.insertBefore(span, textNode.nextSibling);
          } else {
            parent?.appendChild(span);
          }
        }
      } else {
        range.insertNode(span);
      }

      const newRange = document.createRange();
      if (span.firstChild) {
        newRange.setStart(span.firstChild, 1);
      } else {
        newRange.setStartAfter(span);
      }
      newRange.collapse(true);
      finalSelection.removeAllRanges();
      finalSelection.addRange(newRange);

      selectedTextColorRef.current = color;
      handleContentChange();
    }
  };

  if (shouldFocus) {
    requestAnimationFrame(processColorApplication);
  } else {
    processColorApplication();
  }
}

/**
 * Apply a text color to the current selection or cursor position.
 * Handles three cases:
 * 1. Text is selected -> wrap in color span
 * 2. Cursor only (collapsed range) -> create zero-width color span
 * 3. No selection/focus -> focus editor and apply
 */
export function applyTextColor(
  color: string,
  refs: TextColorRefs,
  callbacks: TextColorCallbacks,
): void {
  const { contentRef, activeColorSpanRef, selectedTextColorRef } = refs;
  const { setCurrentTextColor, setShowTextColorPicker, handleContentChange } =
    callbacks;

  if (isInTitleInput()) {
    setShowTextColorPicker(false);
    return;
  }

  selectedTextColorRef.current = color;
  setCurrentTextColor(color);

  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    if (!contentRef.current?.contains(range.commonAncestorContainer)) {
      setShowTextColorPicker(false);
      return;
    }

    const span = document.createElement('span');
    span.style.color = color;

    if (!range.collapsed) {
      try {
        range.surroundContents(span);
        handleContentChange();
      } catch {
        const contents = range.extractContents();
        span.appendChild(contents);
        range.insertNode(span);
        handleContentChange();
      }
    } else {
      if (activeColorSpanRef.current) {
        const oldSpan = activeColorSpanRef.current;
        if (oldSpan.textContent === '\u200B' || oldSpan.textContent === '') {
          oldSpan.remove();
        }
      }

      span.textContent = '\u200B';
      activeColorSpanRef.current = span;
      range.insertNode(span);

      const newRange = document.createRange();
      newRange.setStart(span.firstChild!, 1);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);

      contentRef.current?.focus();
      handleContentChange();
    }
  } else {
    applyTextColorNoSelection(color, refs, callbacks);
  }

  setShowTextColorPicker(false);
}
