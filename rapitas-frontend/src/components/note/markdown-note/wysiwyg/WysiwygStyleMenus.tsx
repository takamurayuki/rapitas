'use client';
/**
 * WysiwygStyleMenus
 *
 * The toolbar's text colour, highlight and font size menus, and the small
 * popover the toolbar's menus share. Colours are the palette or a typed
 * #RRGGBB; sizes are the 8..72px presets — so every choice is an allowed
 * inline form.
 * Not responsible for applying them; see wysiwyg-commands.ts.
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { ALargeSmall, Baseline, Highlighter, type LucideIcon } from 'lucide-react';
import {
  applyFontSize,
  applyHighlight,
  applyTextColor,
  isNoteHexColour,
  restoreSelection,
  saveSelection,
} from './wysiwyg-commands';
import { NOTE_FONT_SIZES, NOTE_HIGHLIGHT_COLORS, NOTE_TEXT_COLORS } from './wysiwyg-palette';

interface ToolbarPopoverProps {
  icon: LucideIcon;
  label: string;
  /** Called when the menu opens (e.g. to keep the selection) / 開いたとき */
  onOpen?: () => void;
  children: (close: () => void) => ReactNode;
}

/**
 * A toolbar button that opens a panel below it; closes on an outside click.
 *
 * @param props - Icon, label, open callback and the panel content / アイコン・ラベル・内容
 */
export function ToolbarPopover({ icon: Icon, label, onOpen, children }: ToolbarPopoverProps) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        <Icon className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-50 max-h-72 min-w-36 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface StyleMenusProps {
  surfaceRef: RefObject<HTMLDivElement | null>;
  onCommand: () => void;
}

/**
 * Text colour, highlight and font size menus.
 *
 * @param props - The surface ref and the edit callback / 編集面と変更通知
 */
export default function WysiwygStyleMenus({ surfaceRef, onCommand }: StyleMenusProps) {
  const t = useTranslations('notes.markdownNote.toolbar');
  const saved = useRef<Range | null>(null);
  const [code, setCode] = useState('');
  const keep = () => {
    saved.current = surfaceRef.current ? saveSelection(surfaceRef.current) : null;
  };
  const apply = (command: (root: HTMLDivElement) => boolean, close: () => void) => {
    const root = surfaceRef.current;
    restoreSelection(saved.current);
    if (root && command(root)) onCommand();
    close();
  };
  const swatch = (key: string, value: string, label: string, onPick: () => void) => (
    <button
      key={key}
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className="w-6 h-6 rounded border border-zinc-300 dark:border-zinc-600"
      style={{ backgroundColor: value }}
    />
  );

  return (
    <>
      <ToolbarPopover icon={Baseline} label={t('textColor')} onOpen={keep}>
        {(close) => (
          <div className="p-2 space-y-2">
            <div className="grid grid-cols-6 gap-1">
              {NOTE_TEXT_COLORS.map((c) =>
                swatch(c.value, c.value, c.name, () =>
                  apply((root) => applyTextColor(root, c.value), close),
                ),
              )}
            </div>
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!isNoteHexColour(code)) return;
                apply((root) => applyTextColor(root, code), close);
                setCode('');
              }}
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="#RRGGBB"
                aria-label={t('customColor')}
                aria-invalid={code !== '' && !isNoteHexColour(code)}
                className="w-24 rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-800 aria-[invalid=true]:border-red-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
              <button
                type="submit"
                className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
              >
                {t('apply')}
              </button>
            </form>
          </div>
        )}
      </ToolbarPopover>
      <ToolbarPopover icon={Highlighter} label={t('highlight')} onOpen={keep}>
        {(close) => (
          <div className="grid grid-cols-6 gap-1 p-2">
            {NOTE_HIGHLIGHT_COLORS.map((c) =>
              swatch(c.key, c.value, t(`highlightColors.${c.key}`), () =>
                apply((root) => applyHighlight(root, c.value), close),
              ),
            )}
          </div>
        )}
      </ToolbarPopover>
      <ToolbarPopover icon={ALargeSmall} label={t('fontSize')} onOpen={keep}>
        {(close) =>
          NOTE_FONT_SIZES.map((px) => (
            <button
              key={px}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply((root) => applyFontSize(root, px), close)}
              className="block w-full px-3 py-1 text-left text-xs text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {px}px
            </button>
          ))
        }
      </ToolbarPopover>
    </>
  );
}
