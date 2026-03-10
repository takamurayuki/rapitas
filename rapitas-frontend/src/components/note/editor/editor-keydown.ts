import type React from 'react';

interface EditorRefs {
  contentRef: React.RefObject<HTMLDivElement | null>;
  activeColorSpanRef: React.MutableRefObject<HTMLSpanElement | null>;
  selectedTextColorRef: React.MutableRefObject<string | null>;
}

/**
 * Handles Backspace key behavior in the editor.
 * Manages line merging for empty lines, and color span persistence.
 * Returns true if the event was handled and default should be prevented.
 */
function handleBackspace(
  e: React.KeyboardEvent<HTMLDivElement>,
  refs: EditorRefs,
  onContentChange: () => void,
): void {
  const { contentRef, activeColorSpanRef, selectedTextColorRef } = refs;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);

  if (range.collapsed && range.startOffset === 0) {
    const node = range.startContainer;

    let isLineEmpty = false;
    let currentElement: Element | null = null;

    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent) {
        currentElement = parent;
        if (parent.tagName === 'SPAN' && parent.parentElement) {
          currentElement = parent.parentElement;
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      currentElement = node as Element;
    }

    if (currentElement) {
      if (currentElement.tagName === 'LI') {
        isLineEmpty = currentElement.textContent?.trim() === '';
      } else {
        let checkNode: Node | null = currentElement;
        let hasContent = false;

        while (checkNode && checkNode !== contentRef.current) {
          if (checkNode.nodeType === Node.TEXT_NODE) {
            const text = checkNode.textContent || '';
            if (text.trim() !== '' && text !== '\u200B') {
              hasContent = true;
              break;
            }
          } else if (checkNode.nodeType === Node.ELEMENT_NODE) {
            const elem = checkNode as Element;
            if (elem.tagName === 'BR') break;
            if (elem.tagName === 'SPAN') {
              const spanText = elem.textContent || '';
              if (spanText.trim() !== '' && spanText !== '\u200B') {
                hasContent = true;
                break;
              }
            }
          }

          if (checkNode.firstChild) {
            checkNode = checkNode.firstChild;
          } else if (checkNode.nextSibling) {
            checkNode = checkNode.nextSibling;
          } else {
            let parent: Node | null = checkNode.parentNode;
            while (
              parent &&
              parent !== contentRef.current &&
              !parent.nextSibling
            ) {
              parent = parent.parentNode;
            }
            checkNode = parent?.nextSibling || null;
          }
        }

        isLineEmpty = !hasContent;
      }
    }

    if (isLineEmpty) {
      let previousElement: Element | null = null;

      if (node.nodeType === Node.TEXT_NODE) {
        const parent = node.parentElement;
        if (parent && parent.tagName === 'SPAN') {
          previousElement = parent.previousElementSibling;

          if (!previousElement && parent.parentElement) {
            const grandParent = parent.parentElement;

            if (
              grandParent.tagName === 'LI' &&
              grandParent.previousElementSibling
            ) {
              const prevLi = grandParent.previousElementSibling;
              if (prevLi.tagName === 'LI') {
                e.preventDefault();
                const newRange = document.createRange();
                const lastChild = prevLi.lastChild || prevLi;
                if (lastChild.nodeType === Node.TEXT_NODE) {
                  newRange.setStart(
                    lastChild,
                    lastChild.textContent?.length || 0,
                  );
                } else {
                  newRange.setStartAfter(lastChild);
                }
                newRange.collapse(true);
                selection.removeAllRanges();
                selection.addRange(newRange);
                onContentChange();
                return;
              }
            }

            if (grandParent.previousElementSibling) {
              previousElement = grandParent.previousElementSibling;
            }
          }
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        previousElement = (node as Element).previousElementSibling;
      }

      if (previousElement && previousElement.tagName === 'BR') {
        e.preventDefault();

        const newRange = document.createRange();

        if (previousElement.previousSibling) {
          const prevNode = previousElement.previousSibling;
          if (prevNode.nodeType === Node.TEXT_NODE) {
            newRange.setStart(prevNode, prevNode.textContent?.length || 0);
          } else if (
            prevNode.nodeType === Node.ELEMENT_NODE &&
            prevNode.lastChild
          ) {
            const lastChild = prevNode.lastChild;
            if (lastChild.nodeType === Node.TEXT_NODE) {
              newRange.setStart(lastChild, lastChild.textContent?.length || 0);
            } else {
              newRange.setStartAfter(lastChild);
            }
          } else {
            newRange.setStartBefore(previousElement);
          }
        } else {
          newRange.setStartBefore(previousElement);
        }

        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);

        previousElement.remove();
        onContentChange();
        return;
      }
    }
  }

  // activeColorSpanがある場合の処理
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
    if (
      node.nodeType === Node.ELEMENT_NODE &&
      (node as HTMLElement).tagName === 'SPAN'
    ) {
      const el = node as HTMLElement;
      if (
        el.style.backgroundColor ||
        el.style.background ||
        el.style.borderLeft
      ) {
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
