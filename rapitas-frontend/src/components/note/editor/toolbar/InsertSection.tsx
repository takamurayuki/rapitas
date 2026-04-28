'use client';
// InsertSection
import { TextQuote, Table, Link2, Code2, Loader2 } from 'lucide-react';
import { borderLineColors, programmingLanguages } from '../constants';

interface InsertSectionProps {
  showLinkInput: boolean;
  showBorderPicker: boolean;
  showCodeInput: boolean;
  linkUrl: string;
  isLinkLoading: boolean;
  codeLanguage: string;
  setLinkUrl: (v: string) => void;
  setCodeLanguage: (v: string) => void;
  setShowLinkInput: (v: boolean) => void;
  onToggleBorderPicker: () => void;
  onInsertTable: () => void;
  onInsertLink: () => void;
  onInsertCodeBlock: () => void;
  onOpenLinkInput: () => void;
  onOpenCodeInput: () => void;
  onApplyBorderLine: (color: string) => void;
}

/**
 * Renders toolbar buttons for link, border line, table, and code block insertion
 * along with their respective popup inputs.
 *
 * @param props - Visibility flags, input state, setters, and action callbacks
 */
export function InsertSection({
  showLinkInput,
  showBorderPicker,
  showCodeInput,
  linkUrl,
  isLinkLoading,
  codeLanguage,
  setLinkUrl,
  setCodeLanguage,
  setShowLinkInput,
  onToggleBorderPicker,
  onInsertTable,
  onInsertLink,
  onInsertCodeBlock,
  onOpenLinkInput,
  onOpenCodeInput,
  onApplyBorderLine,
}: InsertSectionProps) {
  return (
    <>
      {/* Link input */}
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
                {isLinkLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '挿入'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 mx-1" />

      {/* Border line */}
      <div className="relative">
        <button
          onClick={onToggleBorderPicker}
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
                  <span className="text-xs text-zinc-700 dark:text-zinc-200">{color.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <button
        onClick={onInsertTable}
        className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
        title="テーブル挿入"
      >
        <Table className="w-3.5 h-3.5" />
      </button>

      {/* Code block */}
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
    </>
  );
}
