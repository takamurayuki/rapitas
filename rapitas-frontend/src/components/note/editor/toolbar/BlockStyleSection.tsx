'use client';
/**
 * BlockStyleSection
 *
 * JIRA-style block style dropdown for the editor toolbar: shows the block
 * type at the caret and converts blocks to 標準テキスト / 見出し1-3.
 * Conversion logic lives in block-format.ts; this file is UI only.
 */
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import type { BlockType } from '../block-format';

interface BlockStyleSectionProps {
  currentBlockType: BlockType;
  showBlockPicker: boolean;
  onToggleBlockPicker: () => void;
  onApplyBlockType: (type: BlockType) => void;
}

/** Option metadata: i18n label key, JIRA-style preview styling, shortcut hint. */
const BLOCK_OPTIONS: {
  type: BlockType;
  labelKey: string;
  shortcut: string;
  previewClass: string;
}[] = [
  { type: 'p', labelKey: 'normal', shortcut: 'Ctrl+Alt+0', previewClass: 'text-sm' },
  { type: 'h1', labelKey: 'h1', shortcut: 'Ctrl+Alt+1', previewClass: 'text-xl font-bold' },
  { type: 'h2', labelKey: 'h2', shortcut: 'Ctrl+Alt+2', previewClass: 'text-lg font-bold' },
  { type: 'h3', labelKey: 'h3', shortcut: 'Ctrl+Alt+3', previewClass: 'text-base font-semibold' },
];

/**
 * Renders the block style dropdown (current type trigger + styled options).
 *
 * @param props - Current type, visibility, toggle, and apply callbacks
 */
export function BlockStyleSection({
  currentBlockType,
  showBlockPicker,
  onToggleBlockPicker,
  onApplyBlockType,
}: BlockStyleSectionProps) {
  const t = useTranslations('notes');

  // NOTE: Same mousedown suppression as FontPickerSection — the editor must
  // keep focus and its selection while the dropdown is used.
  const keepEditorFocus = (e: React.MouseEvent) => e.preventDefault();

  const current = BLOCK_OPTIONS.find((o) => o.type === currentBlockType) ?? BLOCK_OPTIONS[0];

  return (
    <div className="relative">
      <button
        onMouseDown={keepEditorFocus}
        onClick={onToggleBlockPicker}
        className="flex items-center gap-0.5 px-1.5 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors text-xs min-w-[88px] justify-between h-6"
        title={t('toolbar.blockStyle.title')}
        data-popup-trigger="1"
      >
        <span className="truncate">{t(`toolbar.blockStyle.${current.labelKey}`)}</span>
        <ChevronDown className="w-2.5 h-2.5 shrink-0" />
      </button>
      {showBlockPicker && (
        <div className="absolute top-full left-0 mt-1 p-1 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 w-56">
          <div className="space-y-0.5">
            {BLOCK_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                onMouseDown={keepEditorFocus}
                onClick={() => onApplyBlockType(opt.type)}
                className={`w-full flex items-center justify-between gap-2 text-left px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors ${
                  currentBlockType === opt.type ? 'bg-zinc-100 dark:bg-zinc-700' : ''
                }`}
              >
                {/* Options render in their own style, JIRA-style. */}
                <span className={opt.previewClass}>{t(`toolbar.blockStyle.${opt.labelKey}`)}</span>
                <span className="text-[10px] text-zinc-400 dark:text-zinc-500 shrink-0">
                  {opt.shortcut}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
