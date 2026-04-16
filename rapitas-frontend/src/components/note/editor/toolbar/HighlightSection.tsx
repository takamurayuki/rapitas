'use client';
// HighlightSection
import { Highlighter } from 'lucide-react';
import { highlightColors, highlightStyles } from '../constants';

interface HighlightSectionProps {
  highlightStyleIndex: number;
  showColorPicker: boolean;
  setHighlightStyleIndex: (v: number) => void;
  onToggleColorPicker: () => void;
  onApplyHighlight: (color: string) => void;
}

/**
 * Renders the highlight button and its dropdown with style selector and color list.
 *
 * @param props - Style index, visibility, setter, toggle, and apply callbacks
 */
export function HighlightSection({
  highlightStyleIndex,
  showColorPicker,
  setHighlightStyleIndex,
  onToggleColorPicker,
  onApplyHighlight,
}: HighlightSectionProps) {
  return (
    <div className="relative">
      <button
        onClick={onToggleColorPicker}
        className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
        title="ハイライト"
      >
        <Highlighter className="w-3.5 h-3.5" />
      </button>
      {showColorPicker && (
        <div className="absolute top-full left-0 mt-1 p-3 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 w-52">
          {/* Style selector */}
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
          {/* Color selector */}
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
  );
}
