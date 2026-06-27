/**
 * editor-keydown
 *
 * Entry point for the note editor's keydown handling. Dispatches to the
 * domain-specific handlers (backspace, enter, code-block guards) and re-exports
 * their public API for backward-compatible imports.
 */
import type React from 'react';
import type { EditorRefs } from './editor-keydown.types';
import { handleBackspace, handleColorSpanAfterDelete } from './editor-keydown-backspace';
import { handleEnter } from './editor-keydown-enter';
import {
  isCursorInCodeBlock,
  selectionCoversCodeBlock,
  prevSiblingIsCodeBlock,
  nextSiblingIsCodeBlock,
} from './editor-keydown-code-block';

export type { EditorRefs } from './editor-keydown.types';

/**
 * Main editor keydown handler.
 * Delegates to specialised handlers for Backspace, Delete, and Enter.
 */
export function handleEditorKeyDown(
  e: React.KeyboardEvent<HTMLDivElement>,
  refs: EditorRefs,
  onContentChange: () => void,
): void {
  const { contentRef } = refs;

  // When the caret is inside a code block, let the code element's own onkeydown
  // handle Enter / Tab / Backspace / Delete.  The outer editor must not interfere.
  if (isCursorInCodeBlock(contentRef)) return;

  // Guard: keyboard deletion of a code block container is forbidden.
  // The user must use the dedicated trash button to remove a code block.
  if (e.key === 'Backspace' || e.key === 'Delete') {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);

      if (selectionCoversCodeBlock(range)) {
        // Selection spans the block — cancel the whole delete operation.
        e.preventDefault();
        return;
      }

      if (range.collapsed) {
        if (e.key === 'Backspace' && prevSiblingIsCodeBlock(range, contentRef)) {
          // Caret at start of the line just after a code block.
          e.preventDefault();
          return;
        }
        if (e.key === 'Delete' && nextSiblingIsCodeBlock(range, contentRef)) {
          // Caret at end of the line just before a code block.
          e.preventDefault();
          return;
        }
      }
    }
  }

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
