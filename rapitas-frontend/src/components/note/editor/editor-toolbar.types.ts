/**
 * editor-toolbar.types
 *
 * The prop contract between useNoteEditor and the toolbar. Split out of
 * EditorToolbar.tsx so the component file stays about rendering.
 */
import type { BlockType } from './block-format';

export interface EditorToolbarProps {
  // Format state
  currentBlockType: BlockType;
  currentFont: string;
  currentFontSize: string;
  currentTextColor: string;
  highlightStyleIndex: number;

  // Popup visibility
  showBlockPicker: boolean;
  showFontPicker: boolean;
  showFontSizePicker: boolean;
  showTextColorPicker: boolean;
  showColorPicker: boolean;
  showBorderPicker: boolean;
  showTablePicker: boolean;
  showLinkInput: boolean;
  showCodeInput: boolean;

  // Link/code input state
  linkUrl: string;
  isLinkLoading: boolean;
  codeLanguage: string;

  // Setters
  setCurrentFont: (v: string) => void;
  setCurrentFontSize: (v: string) => void;
  setCurrentTextColor: (v: string) => void;
  setHighlightStyleIndex: (v: number) => void;
  setShowBlockPicker: (v: boolean) => void;
  setShowFontPicker: (v: boolean) => void;
  setShowFontSizePicker: (v: boolean) => void;
  setShowTextColorPicker: (v: boolean) => void;
  setShowColorPicker: (v: boolean) => void;
  setShowBorderPicker: (v: boolean) => void;
  setShowTablePicker: (v: boolean) => void;
  setShowLinkInput: (v: boolean) => void;
  setShowCodeInput: (v: boolean) => void;
  setLinkUrl: (v: string) => void;
  setCodeLanguage: (v: string) => void;

  // Action callbacks
  onApplyBlockType: (type: BlockType) => void;
  onApplyFormat: (command: string, value?: string) => void;
  onApplyHighlight: (color: string) => void;
  onApplyBorderLine: (color: string) => void;
  onApplyFontSize: (size: string) => void;
  onApplyFont: (font: string) => void;
  onApplyTextColor: (color: string) => void;
  onInsertTable: (shape: { rows: number; columns: number }) => void;
  isCaretInTable: () => boolean;
  onInsertTableRow: (side: 'above' | 'below') => void;
  onInsertTableColumn: (side: 'left' | 'right') => void;
  onDeleteTableRow: () => void;
  onDeleteTableColumn: () => void;
  onDeleteTable: () => void;
  onInsertLink: () => void;
  onInsertCodeBlock: () => void;
  onInsertDiagram: () => void;
  onOpenLinkInput: () => void;
  onOpenCodeInput: () => void;
  onResetTextColor: () => void;

  // Helpers
  closeAllPopups: () => void;
  onTextColorButtonClick: () => void;
}
