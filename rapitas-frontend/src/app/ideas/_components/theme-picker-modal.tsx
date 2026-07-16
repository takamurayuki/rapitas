/**
 * ThemePickerModal
 *
 * Forces a theme selection before converting a theme-less (global) idea to a
 * task, since workflow registration requires a theme. Pure presentational.
 */
'use client';
import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, X } from 'lucide-react';
import type { Category, Theme } from '@/types';
import type { Idea } from './idea-box.types';
import { useFocusTrap } from '@/components/ui/modal/use-focus-trap';

interface ThemePickerModalProps {
  idea: Idea;
  categories: Category[];
  themePickerThemes: Theme[];
  themePickerCategoryId: number | null;
  onCategoryChange: (id: number | null) => void;
  themePickerThemeId: number | null;
  setThemePickerThemeId: Dispatch<SetStateAction<number | null>>;
  onClose: () => void;
  onSubmit: () => void;
}

/**
 * Render the theme-selection modal for converting a theme-less idea.
 *
 * @param props - The idea plus theme-picker state and handlers from useIdeaBox. / アイデアとテーマ選択状態・ハンドラ。
 */
export function ThemePickerModal({
  idea,
  categories,
  themePickerThemes,
  themePickerCategoryId,
  onCategoryChange,
  themePickerThemeId,
  setThemePickerThemeId,
  onClose,
  onSubmit,
}: ThemePickerModalProps) {
  const t = useTranslations('ideaBox');
  const tCommon = useTranslations('common');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useFocusTrap(panelRef, true);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-picker-modal-title"
        tabIndex={-1}
        className="w-full max-w-md mx-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h2
            id="theme-picker-modal-title"
            className="text-base font-semibold text-zinc-900 dark:text-zinc-100"
          >
            {t('themePicker.title')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={tCommon('close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">{t('themePicker.description')}</p>
          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800/50 px-3 py-2">
            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">
              {idea.title}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('themePicker.categoryLabel')}
            </label>
            <select
              value={themePickerCategoryId ?? ''}
              onChange={(e) => onCategoryChange(e.target.value ? parseInt(e.target.value) : null)}
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <option value="">{tCommon('all')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('themePicker.themeLabel')} <span className="text-red-500">*</span>
            </label>
            <select
              value={themePickerThemeId ?? ''}
              onChange={(e) =>
                setThemePickerThemeId(e.target.value ? parseInt(e.target.value) : null)
              }
              className="w-full rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <option value="">{t('themePicker.themeSelectPlaceholder')}</option>
              {themePickerThemes.map((th) => (
                <option key={th.id} value={th.id}>
                  {th.name}
                </option>
              ))}
            </select>
            {themePickerThemes.length === 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                {t('themePicker.noThemesWarning')}
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50 rounded-b-lg">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700"
          >
            {tCommon('cancel')}
          </button>
          <button
            onClick={onSubmit}
            disabled={themePickerThemeId === null}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            {t('card.convertButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
