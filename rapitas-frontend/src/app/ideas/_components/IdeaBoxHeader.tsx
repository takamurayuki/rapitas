/**
 * IdeaBoxHeader
 *
 * Page header for the IdeaBox: title, idea count, and the primary add action.
 * Pure presentational.
 */
'use client';
import { useTranslations } from 'next-intl';
import { Lightbulb, Plus } from 'lucide-react';

interface IdeaBoxHeaderProps {
  totalIdeas: number;
  onAddClick: () => void;
}

/**
 * Render the IdeaBox page header.
 *
 * @param props - Total idea count and the add-button handler. / アイデア総数と追加ボタンのハンドラ。
 */
export function IdeaBoxHeader({ totalIdeas, onAddClick }: IdeaBoxHeaderProps) {
  const t = useTranslations('ideaBox');

  const statusText =
    totalIdeas === 0 ? t('header.statusEmpty') : t('header.statusCount', { count: totalIdeas });

  // Amber matches IdeaBoxPanel.tsx (the home-widget sibling) — same feature,
  // same palette. See docs/design/ui-design-language.md §5 change log.
  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Lightbulb className="h-6 w-6 shrink-0 text-amber-500" />
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
            {t('header.title')}
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('header.subtitle')}</p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-500">{statusText}</p>
        </div>
      </div>
      <button
        onClick={onAddClick}
        className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        <Plus className="h-4 w-4" />
        {t('header.addButton')}
      </button>
    </div>
  );
}
