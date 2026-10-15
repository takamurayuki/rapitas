/**
 * color-persistence
 *
 * Input-event handling for the note editor: text-color span persistence and
 * the cleanup of zero-width-space caret anchors (font/size/color spans).
 * IME-safe: while a composition is active every DOM mutation is deferred to
 * a single cleanup pass on compositionend.
 */
import type React from 'react';

const ZWSP = '​';

interface ColorRefs {
  contentRef: React.RefObject<HTMLDivElement | null>;
  activeColorSpanRef: React.MutableRefObject<HTMLSpanElement | null>;
  selectedTextColorRef: React.MutableRefObject<string | null>;
  /** True while an IME composition session is active (optional for tests). */
  isComposingRef?: React.MutableRefObject<boolean>;
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
 * Tracks whether typing stayed inside the active color span and re-wraps the
 * last typed character when a persistent text color is selected. Direct
 * (non-IME) input only — char-based logic cannot apply to composed strings.
 */
function trackColorSpan(e: React.FormEvent<HTMLDivElement>, refs: ColorRefs): void {
  const { contentRef, activeColorSpanRef, selectedTextColorRef } = refs;

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
 * Removes zero-width-space caret anchors once real content exists: strips the
 * leading ZWSP from the anchor span under the caret (restoring the caret) and
 * deletes orphaned ZWSP-only text nodes the cursor has left. Idempotent — a
 * second pass (e.g. Safari fires one more input event after compositionend)
 * is a no-op.
 *
 * @param refs - Editor refs (content element + span tracking) / エディタ参照群
 */
export function runEditorCleanup(refs: ColorRefs): void {
  const { contentRef, activeColorSpanRef } = refs;

  const sel = window.getSelection();
  const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  const caretNode = range ? range.startContainer : null;

  // Strip the leading ZWSP from the caret's anchor span (font/size/color all
  // share the anchor pattern) once a real character has been committed.
  if (
    sel &&
    range &&
    caretNode &&
    caretNode.nodeType === Node.TEXT_NODE &&
    caretNode.textContent &&
    caretNode.textContent.length > 1 &&
    caretNode.textContent.startsWith(ZWSP)
  ) {
    const parentEl = (caretNode as Text).parentElement;
    if (
      parentEl?.tagName === 'SPAN' &&
      (parentEl.style.fontFamily || parentEl.style.fontSize || parentEl.style.color)
    ) {
      // NOTE: Read the offset BEFORE mutating — `range` is a live Range and
      // replacing the text node's data clamps its offset to 0.
      const offsetBefore = range.startOffset;
      caretNode.textContent = caretNode.textContent.substring(1);
      const restored = document.createRange();
      restored.setStart(
        caretNode,
        Math.min(Math.max(0, offsetBefore - 1), caretNode.textContent.length),
      );
      restored.collapse(true);
      sel.removeAllRanges();
      sel.addRange(restored);
    }
  }

  // Fallback: active color span holding a stale ZWSP while the caret is
  // elsewhere (kept from the pre-split implementation).
  const activeSpan = activeColorSpanRef.current;
  if (
    activeSpan &&
    activeSpan.firstChild !== caretNode &&
    activeSpan.textContent &&
    activeSpan.textContent.length > 1 &&
    activeSpan.textContent.startsWith(ZWSP)
  ) {
    activeSpan.textContent = activeSpan.textContent.substring(1);
  }

  // Remove orphaned ZWSP-only text nodes from font/size spans that the cursor
  // has left. Color spans are excluded — those are managed by activeColorSpanRef.
  if (contentRef.current) {
    contentRef.current.querySelectorAll('span[style]').forEach((span) => {
      if ((span as HTMLElement).style.color) return;
      Array.from(span.childNodes).forEach((child) => {
        if (
          child.nodeType === Node.TEXT_NODE &&
          child.textContent === ZWSP &&
          child !== caretNode
        ) {
          child.remove();
        }
      });
    });
  }
}

/**
 * Handles the onInput event for the contentEditable editor.
 * Manages color span tracking and ZWSP anchor cleanup for direct input.
 *
 * NOTE: While the IME is composing, the DOM under the caret belongs to the
 * IME — rewriting text nodes here desyncs its internal state and leaks
 * pending romaji into the document (e.g. typing テスト yielding 「テストt」).
 * Every mutation is therefore skipped until the compositionend cleanup pass.
 */
export function handleEditorInput(
  e: React.FormEvent<HTMLDivElement>,
  refs: ColorRefs,
  onContentChange: () => void,
): void {
  onContentChange();

  if (refs.isComposingRef?.current) return;

  trackColorSpan(e, refs);
  // NOTE: Runs after trackColorSpan because moveLastCharToColorSpan may have
  // moved the cursor; cleanup re-reads the selection itself.
  runEditorCleanup(refs);
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
      newSpan.textContent = ZWSP;
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
