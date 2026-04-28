'use client';
// TextColorSection
import { Baseline } from 'lucide-react';
import { quickTextColors, grayScalePalette, extendedColorPalette } from '../constants';

interface TextColorSectionProps {
  currentTextColor: string;
  showTextColorPicker: boolean;
  setCurrentTextColor: (v: string) => void;
  onTextColorButtonClick: () => void;
  onApplyTextColor: (color: string) => void;
  onResetTextColor: () => void;
}

/**
 * Renders the text color button and its dropdown color picker panel.
 *
 * @param props - Current color, visibility, setters, and apply/reset callbacks
 */
export function TextColorSection({
  currentTextColor,
  showTextColorPicker,
  setCurrentTextColor,
  onTextColorButtonClick,
  onApplyTextColor,
  onResetTextColor,
}: TextColorSectionProps) {
  return (
    <div className="relative">
      <button
        onClick={onTextColorButtonClick}
        className="px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded transition-colors h-6 flex items-center justify-center"
        title="文字色"
      >
        <Baseline className="w-3.5 h-3.5" style={{ color: currentTextColor }} />
      </button>
      {showTextColorPicker && (
        <div className="absolute top-full left-0 mt-1 p-3 bg-white dark:bg-zinc-800 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 z-10 min-w-60">
          <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2">
            テキスト色
          </div>

          {/* Frequently used colors */}
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
                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: item.color }} />
              </button>
            ))}
          </div>

          <div className="h-px bg-zinc-200 dark:bg-zinc-700 mb-3" />

          {/* Color palette */}
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

          {/* Reset button */}
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
  );
}
