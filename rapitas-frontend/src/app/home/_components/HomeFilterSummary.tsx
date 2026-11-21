'use client';
/**
 * HomeFilterSummary
 *
 * What stands in for the hidden home filter: the selected category and
 * theme, and a control to show the full filter again. The theme stays in
 * view because auto-run acts on it (2026-11-21). The pieces are also used
 * inside AutoRunProgressStrip, which merges them in while auto-run is on.
 * Not responsible for changing the category or theme.
 */
import { FolderKanban, PanelTopOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Category, Theme } from '@/types';
import { getIconComponent } from '@/components/category/icon-data';

/** The hidden filter's selection and the way back to it. */
export interface FilterScope {
  /** Selected category, if any. / 選択中のカテゴリ */
  category: Category | undefined;
  /** Selected theme, if any. / 選択中のテーマ */
  theme: Theme | undefined;
  /** Show the full filter again. / フィルターを再表示 */
  onShow: () => void;
}

/**
 * "開発 › rapitas": the selected category and theme.
 *
 * @param props.category - Selected category / 選択中のカテゴリ
 * @param props.theme - Selected theme / 選択中のテーマ
 * @returns The label / カテゴリとテーマの表示
 */
export function FilterScopeLabel({ category, theme }: Omit<FilterScope, 'onShow'>) {
  const CatIcon = (category && getIconComponent(category.icon || '')) || FolderKanban;
  return (
    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
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
    </span>
  );
}

/**
 * The control that brings the hidden filter back.
 *
 * @param props.onShow - Show the filter / フィルターを再表示
 * @param props.short - Use the short label, for the merged strip / 短い表記にするか
 * @returns The button / 再表示ボタン
 */
export function ShowFilterButton({ onShow, short }: { onShow: () => void; short?: boolean }) {
  const t = useTranslations('home');
  return (
    <button
      type="button"
      onClick={onShow}
      aria-label={t('filterPanel.show')}
      title={t('filterPanel.show')}
      className="inline-flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-zinc-500 transition-colors hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
    >
      <PanelTopOpen className="h-3.5 w-3.5" aria-hidden="true" />
      {short ? t('filterPanel.showShort') : t('filterPanel.show')}
    </button>
  );
}

/**
 * One-line stand-in for the hidden filter while auto-run is not on.
 *
 * NOTE: Drawn like AutoRunProgressStrip — a white band with only a top
 * hairline, 13px text — so it reads as the same band (2026-11-21).
 *
 * @param props - Selected category and theme, and the show handler / 選択中のカテゴリ・テーマと再表示
 * @returns The summary bar / 1行の要約
 */
export function HomeFilterSummary({ category, theme, onShow }: FilterScope) {
  return (
    <div
      data-testid="filter-summary"
      className="mb-3 flex items-center gap-2 border-t border-zinc-200 bg-white px-3.5 py-2 text-[13px] dark:border-zinc-800 dark:bg-zinc-900"
    >
      <FilterScopeLabel category={category} theme={theme} />
      <span className="ml-auto">
        <ShowFilterButton onShow={onShow} />
      </span>
    </div>
  );
}
