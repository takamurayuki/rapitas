'use client';
/**
 * useBlockStyle
 *
 * Toolbar state and callbacks for JIRA-style block styles (paragraph and
 * h1-h3 headings): current-type detection, conversion, and Ctrl+Alt+0-3
 * keyboard shortcuts. DOM conversion itself lives in block-format.ts.
 */
import { useCallback, useState } from 'react';
import type React from 'react';
import { applyBlockFormat, detectCurrentBlockType, type BlockType } from './block-format';

/** All values and handlers returned by useBlockStyle. */
export interface BlockStyleState {
  /** Block type at the caret, kept in sync via detectBlockType. */
  currentBlockType: BlockType;
  /** Re-reads the block type at the current selection. */
  detectBlockType: () => void;
  /** Converts the selected block(s) and closes the dropdown. */
  onApplyBlockType: (type: BlockType) => void;
  /** Handles Ctrl+Alt+0-3; returns true when consumed. */
  handleBlockShortcut: (e: React.KeyboardEvent<HTMLDivElement>) => boolean;
}

// NOTE: e.code (physical digit keys) instead of e.key — with Ctrl+Alt held,
// some layouts (AltGr) report a produced character in e.key, not the digit.
const SHORTCUT_MAP: Record<string, BlockType> = {
  Digit0: 'p',
  Digit1: 'h1',
  Digit2: 'h2',
  Digit3: 'h3',
};

/**
 * Provides block-style state and handlers for the note editor toolbar.
 *
 * @param contentRef - The contentEditable editor ref / エディタ要素のref
 * @param onContentChange - Marks the note dirty after a conversion / 変換後にノートをdirtyにする
 * @param setShowBlockPicker - Dropdown visibility setter / ドロップダウン表示の制御
 * @returns Block style state and callbacks consumed by useNoteEditor
 */
export function useBlockStyle(
  contentRef: React.RefObject<HTMLDivElement | null>,
  onContentChange: () => void,
  setShowBlockPicker: React.Dispatch<React.SetStateAction<boolean>>,
): BlockStyleState {
  const [currentBlockType, setCurrentBlockType] = useState<BlockType>('p');

  const detectBlockType = useCallback(() => {
    setCurrentBlockType(detectCurrentBlockType(contentRef.current));
  }, [contentRef]);

  const onApplyBlockType = useCallback(
    (type: BlockType) => {
      if (applyBlockFormat(contentRef.current, type)) {
        setCurrentBlockType(type);
        onContentChange();
      }
      setShowBlockPicker(false);
    },
    [contentRef, onContentChange, setShowBlockPicker],
  );

  const handleBlockShortcut = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): boolean => {
      if (!e.ctrlKey || !e.altKey) return false;
      const type = SHORTCUT_MAP[e.code];
      if (!type) return false;
      e.preventDefault();
      onApplyBlockType(type);
      return true;
    },
    [onApplyBlockType],
  );

  return { currentBlockType, detectBlockType, onApplyBlockType, handleBlockShortcut };
}
