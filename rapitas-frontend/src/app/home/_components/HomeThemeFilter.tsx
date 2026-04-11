/**
 * HomeThemeFilter
 *
 * Renders the theme filter row (with scroll navigation) and delegates
 * the collapsible expanded panel to HomeExpandedFilters.
 */
'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import type { Priority, Theme } from '@/types';
import {
  Star,
  SwatchBook,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
} from 'lucide-react';
import { getIconComponent } from '@/components/category/icon-data';
import { useTranslations } from 'next-intl';
import { HomeExpandedFilters } from './HomeExpandedFilters';

interface StatusCounts {
  all: number;
  [key: string]: number;
}

interface HomeThemeFilterProps {
  themes: Theme[];
  categoryFilter: number | null;
  themeFilter: number | null;
  filter: string;
  priorityFilter: Priority | null;
  sortBy: 'createdAt' | 'priority' | 'title';
  sortOrder: 'asc' | 'desc';
  isFilterExpanded: boolean;
  isScrollNeeded: boolean;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  statusCounts: StatusCounts;
  themeScrollRef: React.RefObject<HTMLDivElement>;
  onThemeChange: (themeId: number) => void;
  onFilterChange: (status: string) => void;
  onPriorityChange: (priority: Priority | null) => void;
  onSortByChange: (sortBy: 'createdAt' | 'priority' | 'title') => void;
  onSortOrderToggle: () => void;
  onFilterExpandedToggle: () => void;
  onScrollLeft: () => void;
  onScrollRight: () => void;
}

/**
 * Theme selector row and the toggle button for the expanded filter panel.
 *
 * @param props - Theme list, scroll refs, current filter state, and callbacks.
 * @returns The theme filter section JSX.
 */
export function HomeThemeFilter({
  themes,
  categoryFilter,
  themeFilter,
  filter,
  priorityFilter,
  sortBy,
  sortOrder,
  isFilterExpanded,
  isScrollNeeded,
  canScrollLeft,
  canScrollRight,
  statusCounts,
  themeScrollRef,
  onThemeChange,
  onFilterChange,
  onPriorityChange,
  onSortByChange,
  onSortOrderToggle,
  onFilterExpandedToggle,
  onScrollLeft,
  onScrollRight,
}: HomeThemeFilterProps) {
  const router = useRouter();
  const t = useTranslations('home');

  const filteredThemes = themes.filter((theme) => {
    if (categoryFilter === null) return true;
    return theme.categoryId === categoryFilter;
  });

  return (
    <>
      {/* Theme scroll row */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-700">
        {isScrollNeeded && (
          <button
            onClick={onScrollLeft}
            disabled={!canScrollLeft}
            className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-all ${
              canScrollLeft
                ? 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300'
                : 'bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 cursor-not-allowed'
            }`}
            aria-label={t('scrollLeft')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}

        <div
          ref={themeScrollRef}
          className="flex items-center gap-2 overflow-x-auto scroll-smooth flex-1 theme-scroll-hidden"
        >
          {filteredThemes.length === 0 && categoryFilter !== null ? (
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 py-1 px-1">
              <span>NO_THEMES_FOUND</span>
              <button
                onClick={() => router.push('/themes')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded font-mono text-[10px] uppercase tracking-wider bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 dark:hover:bg-amber-500/30 transition-colors"
              >
                <Plus className="w-3 h-3" />
                ADD_THEME
              </button>
            </div>
          ) : (
            filteredThemes.map((theme) => {
              const IconComponent =
                getIconComponent(theme.icon || '') || SwatchBook;
              const isActive = themeFilter === theme.id;
              return (
                <button
                  key={theme.id}
                  onClick={() => onThemeChange(theme.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 font-medium text-xs transition-all whitespace-nowrap shrink-0 rounded-sm ${
                    isActive
                      ? 'shadow-lg font-bold text-white dark:text-white'
                      : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                  style={{
                    backgroundColor: isActive ? theme.color : undefined,
                    color: isActive ? '#ffffff' : theme.color,
                  }}
                >
                  <IconComponent className="w-3.5 h-3.5" />
                  {theme.name}
                  {theme.isDefault && (
                    <Star className="w-2.5 h-2.5 fill-current" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {isScrollNeeded && (
          <button
            onClick={onScrollRight}
            disabled={!canScrollRight}
            className={`shrink-0 flex items-center justify-center w-8 h-8 rounded-lg transition-all ${
              canScrollRight
                ? 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300'
                : 'bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 cursor-not-allowed'
            }`}
            aria-label={t('scrollRight')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}

        {/* Filter expand toggle */}
        <button
          onClick={onFilterExpandedToggle}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider transition-all shrink-0 ${
            isFilterExpanded
              ? 'bg-amber-500 text-white shadow-md'
              : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600'
          }`}
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
            />
          </svg>
          <span className="hidden sm:inline">FILTER</span>
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform duration-200 ${isFilterExpanded ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      <HomeExpandedFilters
        filter={filter}
        priorityFilter={priorityFilter}
        sortBy={sortBy}
        sortOrder={sortOrder}
        isFilterExpanded={isFilterExpanded}
        statusCounts={statusCounts}
        onFilterChange={onFilterChange}
        onPriorityChange={onPriorityChange}
        onSortByChange={onSortByChange}
        onSortOrderToggle={onSortOrderToggle}
      />
    </>
  );
}
