/**
 * HomeFilterPanel
 *
 * Wraps the category + theme filter section with its loading skeleton
 * and error fallback. Renders nothing when there are no categories.
 */
'use client';
import type { Category, Priority, Theme, UserSettings } from '@/types';
import { EnhancedSkeletonBlock } from '@/components/ui/LoadingSpinner';
import { useTranslations } from 'next-intl';
import { HomeCategoryFilter } from './HomeCategoryFilter';
import { HomeThemeFilter } from './HomeThemeFilter';
import React from 'react';

interface HomeFilterPanelProps {
  categories: Category[];
  themes: Theme[];
  categoryFilter: number | null;
  themeFilter: number | null;
  filter: string;
  priorityFilter: Priority | null;
  sortBy: 'createdAt' | 'priority' | 'title';
  sortOrder: 'asc' | 'desc';
  appMode: string;
  globalSettings: UserSettings | null;
  filtersLoading: boolean;
  filtersError: string | null;
  isFilterExpanded: boolean;
  isScrollNeeded: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  statusCounts: { all: number; [key: string]: number };
  themeScrollRef: React.RefObject<HTMLDivElement>;
  onCategoryChange: (categoryId: number, newThemeId: number | null) => void;
  onThemeChange: (themeId: number) => void;
  onFilterChange: (status: string) => void;
  onPriorityChange: (priority: Priority | null) => void;
  onSortByChange: (sortBy: 'createdAt' | 'priority' | 'title') => void;
  onSortOrderToggle: () => void;
  onFilterExpandedToggle: () => void;
  onScrollLeft: () => void;
  onScrollRight: () => void;
  onRetry: (force: boolean) => void;
}

/**
 * Filter area with skeleton, error state, and the full category/theme UI.
 *
 * @param props - All filter state and callbacks.
 * @returns The filter panel JSX.
 */
export function HomeFilterPanel({
  categories,
  themes,
  categoryFilter,
  themeFilter,
  filter,
  priorityFilter,
  sortBy,
  sortOrder,
  appMode,
  globalSettings,
  filtersLoading,
  filtersError,
  isFilterExpanded,
  isScrollNeeded,
  canScrollLeft,
  canScrollRight,
  statusCounts,
  themeScrollRef,
  onCategoryChange,
  onThemeChange,
  onFilterChange,
  onPriorityChange,
  onSortByChange,
  onSortOrderToggle,
  onFilterExpandedToggle,
  onScrollLeft,
  onScrollRight,
  onRetry,
}: HomeFilterPanelProps) {
  const t = useTranslations('home');

  if (filtersError) {
    return (
      <div className="relative overflow-hidden border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 shadow-sm mb-4">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-red-600 dark:text-red-400">⚠️</span>
            <span className="text-sm text-red-700 dark:text-red-300">
              {t('filterDataFailed')}
              {filtersError}
            </span>
          </div>
          <button
            onClick={() => onRetry(true)}
            className="px-3 py-1 text-xs bg-red-100 dark:bg-red-800 text-red-700 dark:text-red-300 rounded hover:bg-red-200 dark:hover:bg-red-700 transition-colors"
          >
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }

  if (filtersLoading) {
    return (
      <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm transition-all duration-300 mb-4 animate-skeleton-fade-in">
        <div className="flex items-center overflow-x-auto bg-slate-50 dark:bg-slate-800/50">
          <div className="flex gap-2 px-3 py-2 min-w-max">
            {([{ w: 'w-16', d: 0 }, { w: 'w-20', d: 100 }, { w: 'w-12', d: 200 }, { w: 'w-18', d: 300 }, { w: 'w-14', d: 400 }] as const).map((item, i) => (
              <EnhancedSkeletonBlock key={i} className={`${item.w} h-6 rounded-md`} delay={item.d} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 flex-1">
            {([{ w: 'w-12', d: 100 }, { w: 'w-16', d: 200 }, { w: 'w-10', d: 300 }, { w: 'w-14', d: 400 }] as const).map((item, i) => (
              <EnhancedSkeletonBlock key={i} className={`${item.w} h-5 rounded-sm`} delay={item.d} />
            ))}
          </div>
          <EnhancedSkeletonBlock className="w-12 h-6 rounded shrink-0" delay={500} />
        </div>
      </div>
    );
  }

  if (categories.length === 0) return null;

  return (
    <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm transition-all duration-300 hover:border-amber-500/50 mb-4">
      <HomeCategoryFilter
        categories={categories}
        themes={themes}
        categoryFilter={categoryFilter}
        themeFilter={themeFilter}
        appMode={appMode}
        globalSettings={globalSettings}
        onCategoryChange={onCategoryChange}
      />
      <HomeThemeFilter
        themes={themes}
        categoryFilter={categoryFilter}
        themeFilter={themeFilter}
        filter={filter}
        priorityFilter={priorityFilter}
        sortBy={sortBy}
        sortOrder={sortOrder}
        isFilterExpanded={isFilterExpanded}
        isScrollNeeded={isScrollNeeded}
        canScrollLeft={canScrollLeft}
        canScrollRight={canScrollRight}
        statusCounts={statusCounts}
        themeScrollRef={themeScrollRef}
        onThemeChange={onThemeChange}
        onFilterChange={onFilterChange}
        onPriorityChange={onPriorityChange}
        onSortByChange={onSortByChange}
        onSortOrderToggle={onSortOrderToggle}
        onFilterExpandedToggle={onFilterExpandedToggle}
        onScrollLeft={onScrollLeft}
        onScrollRight={onScrollRight}
      />
    </div>
  );
}
