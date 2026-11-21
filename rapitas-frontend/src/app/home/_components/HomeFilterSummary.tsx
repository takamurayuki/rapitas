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
      className="mb-3 flex items-center gap-2 border border-slate-300 bg-white px-3 py-1.5 font-mono text-[11px] tracking-wider uppercase shadow-sm dark:border-slate-700 dark:bg-slate-900"
    >
      {category && (
        <span className="flex items-center gap-1.5 font-bold" style={{ color: category.color }}>
          <CatIcon className="h-3.5 w-3.5" />
          {category.name}
        </span>
      )}
      {category && theme && (
        <span aria-hidden="true" className="text-slate-400 dark:text-slate-500">
          ›
        </span>
      )}
      {theme && (
        <span
          className="rounded-md px-2 py-0.5 font-medium normal-case text-white"
          style={{ backgroundColor: theme.color || '#64748b' }}
        >
          {theme.name}
        </span>
      )}
      <button
        type="button"
        onClick={onShow}
        aria-label={t('filterPanel.show')}
        className="ml-auto flex items-center gap-1.5 rounded px-2 py-1 text-slate-500 normal-case transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <PanelTopOpen className="h-3.5 w-3.5" aria-hidden="true" />
        {t('filterPanel.show')}
      </button>
    </div>
  );
}
