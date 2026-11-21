'use client';
/**
 * HomeFilterSummary
 *
 * The home filter folded to one line: the selected category and theme, and
 * a control to show the full filter again. The theme stays in view because
 * auto-run acts on it (2026-11-21). Not responsible for changing them.
 */
import { FolderKanban, PanelTopOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Category, Theme } from '@/types';
import { getIconComponent } from '@/components/category/icon-data';

interface HomeFilterSummaryProps {
  /** Selected category, if any. / 選択中のカテゴリ */
  category: Category | undefined;
  /** Selected theme, if any. / 選択中のテーマ */
  theme: Theme | undefined;
  /** Show the full filter again. / フィルターを再表示 */
  onShow: () => void;
}

/**
 * One-line stand-in for the hidden filter.
 *
 * NOTE: Drawn like AutoRunProgressStrip — a white band with only a top
 * hairline, 13px text — because the outlined, mono-caps version stood out
 * when the two sat one above the other (2026-11-21). The shown filter keeps
 * its own look.
 *
 * @param props.category - Selected category / 選択中のカテゴリ
 * @param props.theme - Selected theme / 選択中のテーマ
 * @param props.onShow - Show the filter / フィルターを再表示
 * @returns The summary bar / 1行の要約
 */
export function HomeFilterSummary({ category, theme, onShow }: HomeFilterSummaryProps) {
  const t = useTranslations('home');
  const CatIcon = (category && getIconComponent(category.icon || '')) || FolderKanban;

  return (
    <div
      data-testid="filter-summary"
      className="mb-3 flex items-center gap-2 border-t border-zinc-200 bg-white px-3.5 py-2 text-[13px] dark:border-zinc-800 dark:bg-zinc-900"
    >
      {category && (
        <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
          <CatIcon className="h-3.5 w-3.5" style={{ color: category.color }} />
          {category.name}
        </span>
      )}
      {category && theme && (
        <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-500">
          ›
        </span>
      )}
      {theme && <span className="font-medium text-zinc-900 dark:text-zinc-50">{theme.name}</span>}
      <button
        type="button"
        onClick={onShow}
        aria-label={t('filterPanel.show')}
        className="ml-auto inline-flex items-center gap-1 text-xs whitespace-nowrap text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <PanelTopOpen className="h-3.5 w-3.5" aria-hidden="true" />
        {t('filterPanel.show')}
      </button>
    </div>
  );
}
