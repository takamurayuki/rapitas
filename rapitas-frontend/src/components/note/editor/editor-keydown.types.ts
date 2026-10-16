/**
 * editor-keydown.types
 *
 * Shared types for the note editor keydown handlers.
 * Holds the editor ref bundle passed to every key handler.
 */
import type React from 'react';

/** Refs the editor key handlers need to read/mutate. */
export interface EditorRefs {
  contentRef: React.RefObject<HTMLDivElement | null>;
  activeColorSpanRef: React.MutableRefObject<HTMLSpanElement | null>;
  selectedTextColorRef: React.MutableRefObject<string | null>;
  /** True while an IME composition session is active. */
  isComposingRef?: React.MutableRefObject<boolean>;
}
