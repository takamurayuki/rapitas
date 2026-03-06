'use client';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Highlighter,
  TextQuote,
  Table,
  Link2,
  Loader2,
  Code2,
  Baseline,
  ChevronDown,
} from 'lucide-react';
import {
  highlightColors,
  borderLineColors,
  highlightStyles,
  programmingLanguages,
  fonts,
  fontSizePresets,
  quickTextColors,
  grayScalePalette,
  extendedColorPalette,
} from './constants';

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

  // Link input state
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

/** Helper to close all popups except the one being toggled */
function useToggle(
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
) {
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
    // Close everything
    Object.entries(setters).forEach(([key, setter]) => {
      if (key === field) {
        setter(!currentValue);
      } else {
        setter(false);
      }
    });
  };
}

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
    setShowTextColorPicker,
    setShowColorPicker,
    setShowBorderPicker,
    setShowLinkInput,
    setShowCodeInput,
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

  const toggleFontPicker = useToggle(props, 'showFontPicker');
  const toggleFontSizePicker = useToggle(props, 'showFontSizePicker');
  const toggleColorPicker = useToggle(props, 'showColorPicker');
  const toggleBorderPicker = useToggle(props, 'showBorderPicker');

  return (
    <div className="flex items-center gap-0.5 px-4 pb-1.5 border-b border-zinc-200 dark:border-zinc-700">
      {/* フォントファミリー */}
      <div className="relative">
        <button
          onClick={toggleFontPicker}
          className="flex items-center gap-0.5 px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors text-xs min-w-[100px] justify-between h-6"
          title="フォント"
        >
          <span className="truncate">
            {fonts.find((f) => f.value === currentFont)?.label || 'デフォルト'}
          </span>
          <ChevronDown className="w-2.5 h-2.5 shrink-0" />
        </button>
        {showFontPicker && (
          <div className="absolute top-full left-0 mt-1 p-1 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 w-52 max-h-64 overflow-y-auto">
            <div className="space-y-0.5">
              {fonts.map((font) => (
                <button
                  key={font.value}
                  onClick={() => {
                    setCurrentFont(font.value);
                    onApplyFont(font.value);
                    setShowFontPicker(false);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-sm ${
                    currentFont === font.value
                      ? 'bg-zinc-100 dark:bg-zinc-700'
                      : ''
                  }`}
                >
                  <span style={{ fontFamily: font.value }}>{font.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* フォントサイズ */}
      <div className="relative">
        <input
          type="text"
          value={currentFontSize}
          onChange={(e) => {
            const value = e.target.value.replace(/[^0-9]/g, '');
            if (
              value === '' ||
              (parseInt(value) >= 8 && parseInt(value) <= 72)
            ) {
              setCurrentFontSize(value);
            }
          }}
          onBlur={() => {
            if (currentFontSize === '') {
              setCurrentFontSize('16');
              onApplyFontSize('16px');
            } else {
              onApplyFontSize(`${currentFontSize}px`);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const size =
                currentFontSize === '' ? 16 : parseInt(currentFontSize);
              onApplyFontSize(`${size}px`);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-10 px-0.5 text-center text-xs bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-500 h-6 rounded"
          title="フォントサイズ"
        />
        <button
          onClick={toggleFontSizePicker}
          className="absolute right-0 top-0 bottom-0 px-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors rounded-r"
        >
          <ChevronDown className="w-2.5 h-2.5" />
        </button>
        {showFontSizePicker && (
          <div className="absolute top-full left-0 mt-1 p-1 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 w-16">
            <div className="space-y-0.5 max-h-48 overflow-y-auto">
              {fontSizePresets.map((size) => (
                <button
                  key={size}
                  onClick={() => {
                    setCurrentFontSize(size.toString());
                    onApplyFontSize(`${size}px`);
                    setShowFontSizePicker(false);
                  }}
                  className={`w-full text-left px-2 py-0.5 rounded hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors text-xs ${
                    currentFontSize === size.toString()
                      ? 'bg-zinc-100 dark:bg-zinc-700'
                      : ''
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

      {/* 基本装飾 */}
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

      {/* 文字色 */}
      <div className="relative">
        <button
          onClick={onTextColorButtonClick}
          className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
          title="文字色"
        >
          <Baseline
            className="w-3.5 h-3.5"
            style={{ color: currentTextColor }}
          />
        </button>
        {showTextColorPicker && (
          <div className="absolute top-full left-0 mt-1 p-3 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 min-w-60">
            <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">
              テキスト色
            </div>

            {/* よく使う色 */}
            <div className="flex justify-between gap-1 mb-3">
              {quickTextColors.map((item) => (
                <button
                  key={item.color}
                  onClick={() => {
                    setCurrentTextColor(item.color);
                    onApplyTextColor(item.color);
                  }}
                  className={`w-8 h-8 rounded-md border transition-all flex items-center justify-center ${
                    currentTextColor === item.color
                      ? 'border-indigo-500 dark:border-indigo-400 ring-2 ring-indigo-500/20'
                      : 'border-zinc-200 dark:border-zinc-600 hover:border-zinc-300 dark:hover:border-zinc-500'
                  }`}
                  title={item.name}
                >
                  <div
                    className="w-4 h-4 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                </button>
              ))}
            </div>

            <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-3" />

            {/* カラーパレット */}
            <div className="space-y-1.5 mb-3">
              <div>
                <div className="grid grid-cols-10 gap-1">
                  {grayScalePalette.map((color) => (
                    <button
                      key={color}
                      onClick={() => {
                        setCurrentTextColor(color);
                        onApplyTextColor(color);
                      }}
                      className={`w-5 h-5 rounded hover:scale-110 transition-all border ${
                        currentTextColor.toUpperCase() === color
                          ? 'border-indigo-500 dark:border-indigo-400 ring-1 ring-indigo-500'
                          : 'border-zinc-200 dark:border-zinc-600'
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="grid grid-cols-10 gap-1">
                  {extendedColorPalette.map((color) => (
                    <button
                      key={color}
                      onClick={() => {
                        setCurrentTextColor(color);
                        onApplyTextColor(color);
                      }}
                      className={`w-5 h-5 rounded hover:scale-110 transition-all border ${
                        currentTextColor.toUpperCase() === color
                          ? 'border-indigo-500 dark:border-indigo-400 ring-1 ring-indigo-500'
                          : 'border-zinc-200 dark:border-zinc-600'
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* リセットボタン */}
            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-700">
              <button
                className="w-full text-center text-xs text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 py-1 px-2 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
                onClick={onResetTextColor}
              >
                デフォルト
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ハイライト */}
      <div className="relative">
        <button
          onClick={toggleColorPicker}
          className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
          title="ハイライト"
        >
          <Highlighter className="w-3.5 h-3.5" />
        </button>
        {showColorPicker && (
          <div className="absolute top-full left-0 mt-1 p-3 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 w-52">
            {/* スタイル選択 */}
            <div className="flex items-center gap-1 mb-2 p-0.5 bg-zinc-100 dark:bg-zinc-700 rounded-md">
              {highlightStyles.map((style, i) => (
                <button
                  key={style.name}
                  onClick={() => setHighlightStyleIndex(i)}
                  className={`flex-1 py-1 rounded text-xs font-medium transition-all ${
                    highlightStyleIndex === i
                      ? 'bg-white dark:bg-zinc-600 shadow-sm text-zinc-900 dark:text-zinc-50'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
                  }`}
                  title={style.name}
                >
                  <span
                    style={{
                      background:
                        style.top === 0
                          ? '#fef08a'
                          : `linear-gradient(transparent ${style.top}%, #fef08a ${style.top}%)`,
                    }}
                  >
                    {style.label}
                  </span>
                </button>
              ))}
            </div>
            {/* カラー選択 */}
            <div className="space-y-1">
              {highlightColors.map((color) => (
                <button
                  key={color.value}
                  onClick={() => onApplyHighlight(color.value)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors group"
                >
                  <span
                    className="w-full text-left text-sm text-zinc-700 dark:text-zinc-200"
                    style={{
                      background:
                        highlightStyles[highlightStyleIndex].top === 0
                          ? color.value
                          : `linear-gradient(transparent ${highlightStyles[highlightStyleIndex].top}%, ${color.value} ${highlightStyles[highlightStyleIndex].top}%)`,
                      padding: '1px 4px',
                      borderRadius: '2px',
                    }}
                  >
                    {color.name}サンプル
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

      {/* リスト */}
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

      {/* 挿入系 */}
      <div className="relative">
        <button
          onClick={onOpenLinkInput}
          className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
          title="リンク挿入"
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>
        {showLinkInput && (
          <div
            className="absolute top-full left-0 mt-1 p-2 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-20 w-64"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).tagName !== 'INPUT') {
                e.stopPropagation();
              }
            }}
          >
            <div className="flex gap-1">
              <input
                type="text"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onInsertLink();
                  }
                  if (e.key === 'Escape') {
                    setShowLinkInput(false);
                  }
                }}
                placeholder="URLを入力..."
                autoFocus
                className="flex-1 min-w-0 px-2 py-1 bg-zinc-50 dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded text-xs text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <button
                onClick={onInsertLink}
                disabled={!linkUrl.trim() || isLinkLoading}
                className="px-2 py-1 bg-indigo-500 hover:bg-indigo-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-600 text-white rounded text-xs transition-colors disabled:cursor-not-allowed shrink-0"
              >
                {isLinkLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  '挿入'
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

      <div className="relative">
        <button
          onClick={toggleBorderPicker}
          className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
          title="縦線"
        >
          <TextQuote className="w-3.5 h-3.5" />
        </button>
        {showBorderPicker && (
          <div className="absolute top-full left-0 mt-1 p-2 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 w-40">
            <div className="space-y-0.5">
              {borderLineColors.map((color) => (
                <button
                  key={color.value}
                  onClick={() => onApplyBorderLine(color.value)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
                >
                  <span
                    className="w-1 h-4 rounded-full shrink-0"
                    style={{ backgroundColor: color.value }}
                  />
                  <span className="text-xs text-zinc-700 dark:text-zinc-200">
                    {color.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <button
        onClick={onInsertTable}
        className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
        title="テーブル挿入"
      >
        <Table className="w-3.5 h-3.5" />
      </button>
      <div className="relative">
        <button
          onClick={onOpenCodeInput}
          className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
          title="コードブロック挿入"
        >
          <Code2 className="w-3.5 h-3.5" />
        </button>
        {showCodeInput && (
          <div
            className="absolute top-full left-0 mt-1 p-3 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-20 w-64"
            onMouseDown={(e) => {
              if (
                (e.target as HTMLElement).tagName !== 'SELECT' &&
                (e.target as HTMLElement).tagName !== 'BUTTON'
              ) {
                e.stopPropagation();
              }
            }}
          >
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">
              プログラミング言語を選択
            </label>
            <select
              value={codeLanguage}
              onChange={(e) => setCodeLanguage(e.target.value)}
              className="w-full px-2 py-1.5 bg-zinc-50 dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 rounded text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 mb-2"
            >
              {programmingLanguages.map((lang) => (
                <option key={lang.value} value={lang.value}>
                  {lang.label}
                </option>
              ))}
            </select>
            <button
              onClick={onInsertCodeBlock}
              className="w-full px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded text-sm transition-colors"
            >
              挿入
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
