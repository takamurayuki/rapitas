/**
 * EditorToolbar
 *
 * Top toolbar for the rich-text note editor.
 * Composes font, text color, highlight, list, and insert tool sections.
 * All popup visibility state and action handlers are passed in from the parent.
 */
'use client';
import { Bold, Italic, Underline, List, ListOrdered } from 'lucide-react';
import { FontPickerSection } from './toolbar/FontPickerSection';
import { TextColorSection } from './toolbar/TextColorSection';
import { HighlightSection } from './toolbar/HighlightSection';
import { InsertSection } from './toolbar/InsertSection';

export interface EditorToolbarProps {
  // Format state
  currentFont: string;
  currentFontSize: string;
  currentTextColor: string;
  highlightStyleIndex: number;

  // Popup visibility
  showFontPicker: boolean;
  showFontSizePicker: boolean;
  showTextColorPicker: boolean;
  showColorPicker: boolean;
  showBorderPicker: boolean;
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
  setShowFontPicker: (v: boolean) => void;
  setShowFontSizePicker: (v: boolean) => void;
  setShowTextColorPicker: (v: boolean) => void;
  setShowColorPicker: (v: boolean) => void;
  setShowBorderPicker: (v: boolean) => void;
  setShowLinkInput: (v: boolean) => void;
  setShowCodeInput: (v: boolean) => void;
  setLinkUrl: (v: string) => void;
  setCodeLanguage: (v: string) => void;

  // Action callbacks
  onApplyFormat: (command: string, value?: string) => void;
  onApplyHighlight: (color: string) => void;
  onApplyBorderLine: (color: string) => void;
  onApplyFontSize: (size: string) => void;
  onApplyFont: (font: string) => void;
  onApplyTextColor: (color: string) => void;
  onInsertTable: () => void;
  onInsertLink: () => void;
  onInsertCodeBlock: () => void;
  onOpenLinkInput: () => void;
  onOpenCodeInput: () => void;
  onResetTextColor: () => void;

  // Helpers
  closeAllPopups: () => void;
  onTextColorButtonClick: () => void;
}

/**
 * Closes all popups except the one identified by `field`, toggling it instead.
 * Returns the toggled boolean value so callers can use it if needed.
 *
 * @param props - Full EditorToolbarProps containing all visibility setters
 * @param field - The popup field to toggle / トグルするポップアップフィールド
 * @returns Toggle function that closes others and flips the target popup
 */
function makeToggle(
  props: EditorToolbarProps,
  field: keyof Pick<
    EditorToolbarProps,
    | 'showFontPicker'
    | 'showFontSizePicker'
    | 'showTextColorPicker'
    | 'showColorPicker'
    | 'showBorderPicker'
    | 'showLinkInput'
    | 'showCodeInput'
  >,
): () => void {
  const setters: Record<string, (v: boolean) => void> = {
    showFontPicker: props.setShowFontPicker,
    showFontSizePicker: props.setShowFontSizePicker,
    showTextColorPicker: props.setShowTextColorPicker,
    showColorPicker: props.setShowColorPicker,
    showBorderPicker: props.setShowBorderPicker,
    showLinkInput: props.setShowLinkInput,
    showCodeInput: props.setShowCodeInput,
  };

  return () => {
    const currentValue = props[field];
    Object.entries(setters).forEach(([key, setter]) => {
      setter(key === field ? !currentValue : false);
    });
  };
}

/**
 * Full editor toolbar composed from section sub-components.
 *
 * @param props - All toolbar state, setters, and action callbacks
 */
export default function EditorToolbar(props: EditorToolbarProps) {
  const {
    currentFont,
    currentFontSize,
    currentTextColor,
    highlightStyleIndex,
    showFontPicker,
    showFontSizePicker,
    showTextColorPicker,
    showColorPicker,
    showBorderPicker,
    showLinkInput,
    showCodeInput,
    linkUrl,
    isLinkLoading,
    codeLanguage,
    setCurrentFont,
    setCurrentFontSize,
    setCurrentTextColor,
    setHighlightStyleIndex,
    setShowFontPicker,
    setShowFontSizePicker,
    setShowLinkInput,
    setLinkUrl,
    setCodeLanguage,
    onApplyFormat,
    onApplyHighlight,
    onApplyBorderLine,
    onApplyFontSize,
    onApplyFont,
    onApplyTextColor,
    onInsertTable,
    onInsertLink,
    onInsertCodeBlock,
    onOpenLinkInput,
    onOpenCodeInput,
    onResetTextColor,
    onTextColorButtonClick,
  } = props;

  const toggleColorPicker = makeToggle(props, 'showColorPicker');
  const toggleBorderPicker = makeToggle(props, 'showBorderPicker');

  return (
    <div className="flex items-center gap-0.5 px-4 pb-1.5 border-b border-zinc-200 dark:border-zinc-700">
      <FontPickerSection
        currentFont={currentFont}
        currentFontSize={currentFontSize}
        showFontPicker={showFontPicker}
        showFontSizePicker={showFontSizePicker}
        setCurrentFont={setCurrentFont}
        setCurrentFontSize={setCurrentFontSize}
        setShowFontPicker={setShowFontPicker}
        setShowFontSizePicker={setShowFontSizePicker}
        onApplyFont={onApplyFont}
        onApplyFontSize={onApplyFontSize}
      />

      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

      {/* Basic formatting */}
      <button
        onClick={() => onApplyFormat('bold')}
        className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
        title="太字"
      >
        <Bold className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onApplyFormat('italic')}
        className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
        title="斜体"
      >
        <Italic className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onApplyFormat('underline')}
        className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
        title="下線"
      >
        <Underline className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

      <TextColorSection
        currentTextColor={currentTextColor}
        showTextColorPicker={showTextColorPicker}
        setCurrentTextColor={setCurrentTextColor}
        onTextColorButtonClick={onTextColorButtonClick}
        onApplyTextColor={onApplyTextColor}
        onResetTextColor={onResetTextColor}
      />

      <HighlightSection
        highlightStyleIndex={highlightStyleIndex}
        showColorPicker={showColorPicker}
        setHighlightStyleIndex={setHighlightStyleIndex}
        onToggleColorPicker={toggleColorPicker}
        onApplyHighlight={onApplyHighlight}
      />

      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

      {/* Lists */}
      <button
        onClick={() => onApplyFormat('insertUnorderedList')}
        className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
        title="箇条書き"
      >
        <List className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onApplyFormat('insertOrderedList')}
        className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
        title="番号付きリスト"
      >
        <ListOrdered className="w-3.5 h-3.5" />
      </button>

      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

      <InsertSection
        showLinkInput={showLinkInput}
        showBorderPicker={showBorderPicker}
        showCodeInput={showCodeInput}
        linkUrl={linkUrl}
        isLinkLoading={isLinkLoading}
        codeLanguage={codeLanguage}
        setLinkUrl={setLinkUrl}
        setCodeLanguage={setCodeLanguage}
        setShowLinkInput={setShowLinkInput}
        onToggleBorderPicker={toggleBorderPicker}
        onInsertTable={onInsertTable}
        onInsertLink={onInsertLink}
        onInsertCodeBlock={onInsertCodeBlock}
        onOpenLinkInput={onOpenLinkInput}
        onOpenCodeInput={onOpenCodeInput}
        onApplyBorderLine={onApplyBorderLine}
      />
    </div>
  );
}
