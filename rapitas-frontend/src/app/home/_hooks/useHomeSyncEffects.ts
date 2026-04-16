'use client';
// useHomeSyncEffects
import { useEffect } from 'react';
import type { Category, Priority, Theme } from '@/types';

interface UseHomeSyncEffectsParams {
  // Filter state
  filter: string;
  categoryFilter: number | null;
  themeFilter: number | null;
  priorityFilter: Priority | null;
  searchQuery: string;
  themes: Theme[];
  visibleCategories: Category[];

  // Setters
  setCategoryFilter: (id: number) => void;
  setThemeFilter: (id: number | null) => void;
  setDefaultTheme: (theme: Theme | null) => void;

  // Pagination
  currentPage: number;
  totalPages: number;
  setCurrentPage: (page: number) => void;

  // Background refresh
  shouldBackgroundRefresh: () => boolean;
  backgroundRefresh: () => void;
}

/**
 * Registers all reactive sync effects for the home page.
 *
 * @param params - State values, setters, and refresh callbacks.
 */
export function useHomeSyncEffects({
  filter,
  categoryFilter,
  themeFilter,
  priorityFilter,
  searchQuery,
  themes,
  visibleCategories,
  setCategoryFilter,
  setThemeFilter,
  setDefaultTheme,
  currentPage,
  totalPages,
  setCurrentPage,
  shouldBackgroundRefresh,
  backgroundRefresh,
}: UseHomeSyncEffectsParams) {
  // Reset to page 1 whenever any filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [
    filter,
    categoryFilter,
    themeFilter,
    priorityFilter,
    searchQuery,
    setCurrentPage,
  ]);

  // Clamp page to valid range when total pages shrinks
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [totalPages, currentPage, setCurrentPage]);

  // Auto-select default theme when themes first load
  useEffect(() => {
    if (themes.length === 0) return;

    const firstDefault = themes.find((t: Theme) => t.isDefault);
    if (firstDefault) setDefaultTheme(firstDefault);

    if (themeFilter === null && categoryFilter !== null) {
      const inCat = themes.filter(
        (t: Theme) => t.categoryId === categoryFilter,
      );
      if (inCat.length > 0) {
        const def = inCat.find((t: Theme) => t.isDefault);
        setThemeFilter((def || inCat[0]).id);
      }
    }
  }, [themes, categoryFilter, themeFilter, setThemeFilter, setDefaultTheme]);

  // Correct active category when app mode change hides it
  useEffect(() => {
    if (visibleCategories.length === 0 || categoryFilter === null) return;
    const isVisible = visibleCategories.some((c) => c.id === categoryFilter);
    if (!isVisible) {
      const newCatId = visibleCategories[0].id;
      setCategoryFilter(newCatId);
      const inNewCat = themes.filter((t) => t.categoryId === newCatId);
      if (inNewCat.length > 0) {
        const def = inNewCat.find((t) => t.isDefault);
        setThemeFilter((def || inNewCat[0]).id);
      } else {
        setThemeFilter(null);
      }
    }
  }, [
    visibleCategories,
    categoryFilter,
    themes,
    setCategoryFilter,
    setThemeFilter,
  ]);

  // Periodic background refresh of filter data
  useEffect(() => {
    const check = () => {
      if (shouldBackgroundRefresh()) backgroundRefresh();
    };
    const initial = setTimeout(check, 60000);
    const interval = setInterval(check, 5 * 60 * 1000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [shouldBackgroundRefresh, backgroundRefresh]);
}
