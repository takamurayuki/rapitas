/**
 * editor-state.types
 *
 * Type definitions for the NoteEditorState object returned by useNoteEditor.
 * Runtime logic lives in useNoteEditor.ts; this file only declares the shape.
 */
import type React from 'react';
import type { Note } from '@/stores/note-store';
import type { BlockType } from './block-format';

/**
 * All values and handlers returned by useNoteEditor.
 */
export interface NoteEditorState {
  // Store
  updateNote: (id: string, data: Partial<Note>) => void;
  locale: string;

  // Refs
  contentRef: React.RefObject<HTMLDivElement | null>;
  titleRef: React.RefObject<HTMLInputElement | null>;

  // Title state
  draftTitle: string;
  isDirty: boolean;
  handleTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleTitlePaste: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  handleSave: () => void;

  // Popup visibility
  showBlockPicker: boolean;
  showColorPicker: boolean;
  showBorderPicker: boolean;
  showLinkInput: boolean;
  showCodeInput: boolean;
  showFontSizePicker: boolean;
  showFontPicker: boolean;
  showTextColorPicker: boolean;
  setShowBlockPicker: React.Dispatch<React.SetStateAction<boolean>>;
  setShowColorPicker: React.Dispatch<React.SetStateAction<boolean>>;
  setShowBorderPicker: React.Dispatch<React.SetStateAction<boolean>>;
  setShowLinkInput: React.Dispatch<React.SetStateAction<boolean>>;
  setShowCodeInput: React.Dispatch<React.SetStateAction<boolean>>;
  setShowFontSizePicker: React.Dispatch<React.SetStateAction<boolean>>;
  setShowFontPicker: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTextColorPicker: React.Dispatch<React.SetStateAction<boolean>>;
  closeAllPopups: () => void;

  // Link
  linkUrl: string;
  isLinkLoading: boolean;
  setLinkUrl: React.Dispatch<React.SetStateAction<string>>;
  openLinkInput: () => void;
  insertLink: () => Promise<void>;

  // Code
  codeLanguage: string;
  setCodeLanguage: React.Dispatch<React.SetStateAction<string>>;
  openCodeInput: () => void;
  insertCodeBlock: () => void;

  // Block style (JIRA-style paragraph/heading selector)
  currentBlockType: BlockType;
  onApplyBlockType: (type: BlockType) => void;

  // Highlight / border / font
  highlightStyleIndex: number;
  setHighlightStyleIndex: React.Dispatch<React.SetStateAction<number>>;
  currentFontSize: string;
  currentFont: string;
  currentTextColor: string;
  setCurrentFont: React.Dispatch<React.SetStateAction<string>>;
  setCurrentFontSize: React.Dispatch<React.SetStateAction<string>>;
  setCurrentTextColor: React.Dispatch<React.SetStateAction<string>>;
  onApplyFormat: (command: string, value?: string) => void;
  onApplyHighlight: (color: string) => void;
  onApplyBorderLine: (color: string) => void;
  onApplyFontSize: (size: string) => void;
  onApplyFont: (font: string) => void;
  applyTextColor: (color: string) => void;
  handleTextColorButtonClick: () => void;
  handleResetTextColor: () => void;

  // Table
  insertTable: () => void;

  // Diagram
  insertDiagramBlock: () => void;
  /** Re-renders a single diagram block's Mermaid SVG (labels bound). / 図ブロックの再描画（ラベル束縛済み） */
  renderDiagramBlock: (block: HTMLElement) => Promise<void>;
  markDirty: () => void;

  // Editor events
  onEditorInput: (e: React.FormEvent<HTMLDivElement>) => void;
  onEditorKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Marks the IME composition session active. / IME変換セッション開始 */
  onEditorCompositionStart: () => void;
  /** Ends the session and runs the deferred anchor cleanup once. / セッション終了と遅延クリーンアップ */
  onEditorCompositionEnd: () => void;
}
