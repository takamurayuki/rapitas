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
import { ChevronRight, FolderKanban, PanelTopOpen, Star, SwatchBook } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Category, Theme } from '@/types';
import { getIconComponent } from '@/components/category/icon-data';
import { HOME_CARD_FRAME } from './home-card-frame';

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
 * The selected category and theme ("開発 > rapitas").
 *
 * @param props.category - Selected category / 選択中のカテゴリ
 * @param props.theme - Selected theme / 選択中のテーマ
 * @returns The label / カテゴリとテーマの表示
 */
export function FilterScopeLabel({ category, theme }: Omit<FilterScope, 'onShow'>) {
  const CatIcon = (category && getIconComponent(category.icon || '')) || FolderKanban;
  const ThemeIcon = (theme && getIconComponent(theme.icon || '')) || SwatchBook;
  return (
    <span className="flex shrink-0 items-center gap-2 whitespace-nowrap">
      {category && (
        <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
          <CatIcon className="h-3.5 w-3.5" style={{ color: category.color }} />
          {category.name}
        </span>
      )}
      {/* NOTE: An icon, not the "›" character, which was too faint to see
          (2026-11-21). */}
      {category && theme && (
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
        />
      )}
      {/* The theme is drawn as the selected chip in HomeThemeFilter draws it
          (theme colour, white bold text, its icon, a star when default), so
          hiding the filter does not change how the theme looks (2026-11-21).
          Keep the two in step. */}
      {theme && (
        <span
          data-testid="scope-theme-chip"
          className="flex items-center gap-1.5 rounded-sm px-3 py-1 text-xs font-bold text-white shadow-lg"
          style={{ backgroundColor: theme.color, color: '#ffffff' }}
        >
          <ThemeIcon className="h-3.5 w-3.5" />
          {theme.name}
          {theme.isDefault && <Star className="h-2.5 w-2.5 fill-current" />}
        </span>
      )}
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
 * NOTE: Drawn in the filter's own card frame (HOME_CARD_FRAME), like
 * AutoRunProgressStrip, so hiding the filter keeps its look (2026-11-21).
 *
 * @param props - Selected category and theme, and the show handler / 選択中のカテゴリ・テーマと再表示
 * @returns The summary bar / 1行の要約
 */
export function HomeFilterSummary({ category, theme, onShow }: FilterScope) {
  return (
    <div
      data-testid="filter-summary"
      className={`${HOME_CARD_FRAME} mb-3 flex items-center gap-2 px-3.5 py-2 text-[13px]`}
    >
      <FilterScopeLabel category={category} theme={theme} />
      {/* flex, not an inline span: an inline wrapper sat the button on the
          text baseline, a little below the middle (2026-11-21). */}
      <span data-testid="show-filter-slot" className="ml-auto flex items-center self-stretch">
        <ShowFilterButton onShow={onShow} />
      </span>
    </div>
  );
}
