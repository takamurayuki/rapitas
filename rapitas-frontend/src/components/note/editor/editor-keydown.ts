import type React from 'react';

interface EditorRefs {
  contentRef: React.RefObject<HTMLDivElement | null>;
  activeColorSpanRef: React.MutableRefObject<HTMLSpanElement | null>;
  selectedTextColorRef: React.MutableRefObject<string | null>;
}

/**
 * Gets the effective line element from a node, handling span wrappers.
 */
function getEffectiveLineElement(node: Node): Element | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent) return null;
    // If parent is a span inside another element, return the grandparent
    if (parent.tagName === 'SPAN' && parent.parentElement) {
      return parent.parentElement;
    }
    return parent;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return node as Element;
  }
  return null;
}

/**
 * Checks if a list item element has meaningful content.
 */
function isListItemEmpty(element: Element): boolean {
  return element.tagName === 'LI' && element.textContent?.trim() === '';
}

/**
 * Traverses DOM to check if there's any meaningful content.
 * Returns true if content is found.
 */
function hasContentInElement(
  element: Element,
  containerRef: React.RefObject<HTMLDivElement | null>,
): boolean {
  let checkNode: Node | null = element;

  while (checkNode && checkNode !== containerRef.current) {
    if (checkNode.nodeType === Node.TEXT_NODE) {
      const text = checkNode.textContent || '';
      if (text.trim() !== '' && text !== '\u200B') return true;
    } else if (checkNode.nodeType === Node.ELEMENT_NODE) {
      const elem = checkNode as Element;
      if (elem.tagName === 'BR') break;
      if (elem.tagName === 'SPAN') {
        const spanText = elem.textContent || '';
        if (spanText.trim() !== '' && spanText !== '\u200B') return true;
      }
    }

    checkNode = getNextTraversalNode(checkNode, containerRef.current);
  }

  return false;
}

/**
 * Gets the next node in DOM traversal order.
 */
function getNextTraversalNode(node: Node, boundary: HTMLDivElement | null): Node | null {
  if (node.firstChild) return node.firstChild;
  if (node.nextSibling) return node.nextSibling;

  let parent: Node | null = node.parentNode;
  while (parent && parent !== boundary && !parent.nextSibling) {
    parent = parent.parentNode;
  }
  return parent?.nextSibling || null;
}

/**
 * Moves cursor to the end of the last child of an element.
 */
function setCursorAtEndOf(element: Element, selection: Selection): void {
  const newRange = document.createRange();
  const lastChild = element.lastChild || element;

  if (lastChild.nodeType === Node.TEXT_NODE) {
    newRange.setStart(lastChild, lastChild.textContent?.length || 0);
  } else {
    newRange.setStartAfter(lastChild);
  }

  newRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(newRange);
}

/**
 * Handles cursor movement to the previous list item.
 * Returns true if handled.
 */
function handlePreviousListItem(
  parent: HTMLElement,
  selection: Selection,
  e: React.KeyboardEvent<HTMLDivElement>,
  onContentChange: () => void,
): boolean {
  const grandParent = parent.parentElement;
  if (!grandParent || grandParent.tagName !== 'LI') return false;

  const prevLi = grandParent.previousElementSibling;
  if (!prevLi || prevLi.tagName !== 'LI') return false;

  e.preventDefault();
  setCursorAtEndOf(prevLi, selection);
  onContentChange();
  return true;
}

/**
 * Finds the previous element for cursor navigation.
 */
function getPreviousElement(node: Node): Element | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent) return null;

    if (parent.tagName === 'SPAN') {
      // Check sibling of span
      if (parent.previousElementSibling) return parent.previousElementSibling;
      // Check sibling of span's parent
      if (parent.parentElement?.previousElementSibling) {
        return parent.parentElement.previousElementSibling;
      }
      return null;
    }
    return parent.previousElementSibling;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    return (node as Element).previousElementSibling;
  }

  return null;
}

/**
 * Handles cursor positioning when merging with BR element.
 */
function handleBrMerge(
  brElement: Element,
  selection: Selection,
  e: React.KeyboardEvent<HTMLDivElement>,
  onContentChange: () => void,
): void {
  e.preventDefault();

  const newRange = document.createRange();
  const prevSibling = brElement.previousSibling;

  if (prevSibling) {
    setCursorPositionFromSibling(prevSibling, newRange);
  } else {
    newRange.setStartBefore(brElement);
  }

  newRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(newRange);

  brElement.remove();
  onContentChange();
}

/**
 * Sets cursor position based on a sibling node.
 */
function setCursorPositionFromSibling(sibling: Node, range: Range): void {
  if (sibling.nodeType === Node.TEXT_NODE) {
    range.setStart(sibling, sibling.textContent?.length || 0);
    return;
  }

  if (sibling.nodeType === Node.ELEMENT_NODE && sibling.lastChild) {
    const lastChild = sibling.lastChild;
    if (lastChild.nodeType === Node.TEXT_NODE) {
      range.setStart(lastChild, lastChild.textContent?.length || 0);
    } else {
      range.setStartAfter(lastChild);
    }
    return;
  }

  range.setStartAfter(sibling);
}

/**
 * Handles Backspace key behavior in the editor.
 * Manages line merging for empty lines, and color span persistence.
 */
function handleBackspace(
  e: React.KeyboardEvent<HTMLDivElement>,
  refs: EditorRefs,
  onContentChange: () => void,
): void {
  const { contentRef } = refs;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);

  // Only handle at the start of a line
  if (!range.collapsed || range.startOffset !== 0) {
    handleColorSpanAfterDelete(refs);
    return;
  }

  const node = range.startContainer;
  const currentElement = getEffectiveLineElement(node);
  if (!currentElement) return;

  // Check if current line is empty
  const isLineEmpty =
    isListItemEmpty(currentElement) || !hasContentInElement(currentElement, contentRef);

  if (!isLineEmpty) {
    handleColorSpanAfterDelete(refs);
    return;
  }

  // Handle list item navigation (for spans inside LI)
  if (node.nodeType === Node.TEXT_NODE && node.parentElement?.tagName === 'SPAN') {
    const handled = handlePreviousListItem(node.parentElement, selection, e, onContentChange);
    if (handled) return;
  }

  // Find and handle merge with previous element
  const previousElement = getPreviousElement(node);
  if (previousElement?.tagName === 'BR') {
    handleBrMerge(previousElement, selection, e, onContentChange);
    return;
  }

  handleColorSpanAfterDelete(refs);
}

/**
 * After a Backspace or Delete, re-create a zero-width color span if needed.
 */
function handleColorSpanAfterDelete(refs: EditorRefs): void {
  const { contentRef, activeColorSpanRef, selectedTextColorRef } = refs;

  if (activeColorSpanRef.current) {
    const activeSpan = activeColorSpanRef.current;
    const spanText = activeSpan.textContent || '';

    if (spanText.length <= 1) {
      setTimeout(() => {
        if (selectedTextColorRef.current && contentRef.current) {
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0) {
            const r = sel.getRangeAt(0);
            if (contentRef.current.contains(r.commonAncestorContainer)) {
              const newSpan = document.createElement('span');
              newSpan.style.color = selectedTextColorRef.current;
              newSpan.textContent = '\u200B';

              r.insertNode(newSpan);
              activeColorSpanRef.current = newSpan;

              const nr = document.createRange();
              nr.setStart(newSpan.firstChild!, 0);
              nr.collapse(true);
              sel.removeAllRanges();
              sel.addRange(nr);
            }
          }
        }
      }, 0);
    }
  }
}

/**
 * Handles Enter key: escapes highlight/border spans, but continues text color spans.
 */
function handleEnter(
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
  if (isTextColorSpan || selectedTextColorRef.current) {
    const newColorSpan = styledSpan.cloneNode(false) as HTMLElement;

    if (selectedTextColorRef.current && !isTextColorSpan) {
      newColorSpan.style.color = selectedTextColorRef.current;
    }

    newColorSpan.textContent = '\u200B';
    activeColorSpanRef.current = newColorSpan;

    if (trailingSpan) {
      br.parentNode!.insertBefore(newColorSpan, trailingSpan);
    } else {
      br.parentNode!.insertBefore(newColorSpan, br.nextSibling);
    }

    newRange.setStart(newColorSpan.firstChild!, 1);
    newRange.collapse(true);
  } else {
    if (trailingSpan) {
      newRange.setStart(trailingSpan, 0);
    } else {
      newRange.setStartAfter(br);
    }
    newRange.collapse(true);
  }

  selection.removeAllRanges();
  selection.addRange(newRange);

  if (!styledSpan.textContent) {
    styledSpan.remove();
  }

  onContentChange();
}

/**
 * Main editor keydown handler.
 * Delegates to specialised handlers for Backspace, Delete, and Enter.
 */
export function handleEditorKeyDown(
  e: React.KeyboardEvent<HTMLDivElement>,
  refs: EditorRefs,
  onContentChange: () => void,
): void {
  if (e.key === 'Backspace') {
    handleBackspace(e, refs, onContentChange);
    return;
  }

  if (e.key === 'Delete') {
    handleColorSpanAfterDelete(refs);
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    handleEnter(e, refs, onContentChange);
  }
}
