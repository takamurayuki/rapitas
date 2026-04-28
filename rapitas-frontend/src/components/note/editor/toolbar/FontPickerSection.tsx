'use client';
// FontPickerSection
import { ChevronDown } from 'lucide-react';
import { fonts, fontSizePresets } from '../constants';

interface FontPickerSectionProps {
  currentFont: string;
  currentFontSize: string;
  showFontPicker: boolean;
  showFontSizePicker: boolean;
  setCurrentFont: (v: string) => void;
  setCurrentFontSize: (v: string) => void;
  setShowFontPicker: (v: boolean) => void;
  setShowFontSizePicker: (v: boolean) => void;
  onApplyFont: (font: string) => void;
  onApplyFontSize: (size: string) => void;
}

/**
 * Renders the font family dropdown and font size input/picker for the editor toolbar.
 *
 * @param props - Current values, visibility flags, setters, and apply callbacks
 */
export function FontPickerSection({
  currentFont,
  currentFontSize,
  showFontPicker,
  showFontSizePicker,
  setCurrentFont,
  setCurrentFontSize,
  setShowFontPicker,
  setShowFontSizePicker,
  onApplyFont,
  onApplyFontSize,
}: FontPickerSectionProps) {
  return (
    <>
      {/* Font family */}
      <div className="relative">
        <button
          onClick={() => {
            setShowFontSizePicker(false);
            setShowFontPicker(!showFontPicker);
          }}
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
                    currentFont === font.value ? 'bg-zinc-100 dark:bg-zinc-700' : ''
                  }`}
                >
                  <span style={{ fontFamily: font.value }}>{font.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Font size */}
      <div className="relative">
        <input
          type="text"
          value={currentFontSize}
          onChange={(e) => {
            const value = e.target.value.replace(/[^0-9]/g, '');
            if (value === '' || (parseInt(value) >= 8 && parseInt(value) <= 72)) {
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
              const size = currentFontSize === '' ? 16 : parseInt(currentFontSize);
              onApplyFontSize(`${size}px`);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="w-10 px-0.5 text-center text-xs bg-white dark:bg-zinc-700 border border-zinc-200 dark:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-indigo-500 h-6 rounded"
          title="フォントサイズ"
        />
        <button
          onClick={() => {
            setShowFontPicker(false);
            setShowFontSizePicker(!showFontSizePicker);
          }}
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
                    currentFontSize === size.toString() ? 'bg-zinc-100 dark:bg-zinc-700' : ''
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
