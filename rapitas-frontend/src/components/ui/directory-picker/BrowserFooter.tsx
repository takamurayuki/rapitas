'use client';

/**
 * directory-picker/BrowserFooter
 *
 * Footer row of the directory browser modal: shows the path that the 選択
 * button will confirm (highlighted row if any, else the current path) and the
 * cancel/select actions. Extracted from BrowserModal for the size policy.
 */

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

type BrowserFooterProps = {
  favoritesOnlyMode: boolean;
  effectivePath: string;
  onConfirm: () => void;
  onClose: () => void;
};

/**
 * Renders the modal footer for both favorites-only and browse modes.
 *
 * @param favoritesOnlyMode - Whether the modal shows only favorites / お気に入り専用モード
 * @param effectivePath - Path the select button will confirm / 選択ボタンが確定するパス
 * @param onConfirm - Confirms effectivePath as the selection / 選択確定コールバック
 * @param onClose - Closes the modal without selecting / 閉じるコールバック
 */
export function BrowserFooter({
  favoritesOnlyMode,
  effectivePath,
  onConfirm,
  onClose,
}: BrowserFooterProps) {
  const t = useTranslations('common');

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
      {favoritesOnlyMode ? (
        <>
          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('directoryPicker.chooseFromFavoritesHint')}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
          >
            {t('cancel')}
          </button>
        </>
      ) : (
        <>
          <div className="text-sm text-zinc-500 dark:text-zinc-400 min-w-0 truncate">
            {t('directoryPicker.currentlySelected')}{' '}
            <span className="font-mono text-zinc-700 dark:text-zinc-300">
              {effectivePath || t('none')}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              onClick={onConfirm}
              disabled={!effectivePath}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4" />
              {t('directoryPicker.select')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
