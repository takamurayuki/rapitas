/**
 * HomeCategoryFilter
 *
 * Renders the horizontal category tab strip at the top of the filter panel.
 * Highlights the active category and calls back when the user switches.
 */
'use client';
import type { Category, Theme, UserSettings } from '@/types';
import { Star, FolderKanban } from 'lucide-react';
import { getIconComponent } from '@/components/category/icon-data';

interface HomeCategoryFilterProps {
  categories: Category[];
  themes: Theme[];
  categoryFilter: number | null;
  themeFilter: number | null;
  appMode: string;
  globalSettings: UserSettings | null;
  onCategoryChange: (categoryId: number, newThemeId: number | null) => void;
}

/**
 * Category tab strip. Switches active category and auto-selects a theme within it.
 *
 * @param props - Category list, current selection, and change callback.
 * @returns The category tab bar JSX.
 */
export function HomeCategoryFilter({
  categories,
  themes,
  categoryFilter,
  themeFilter,
  appMode,
  globalSettings,
  onCategoryChange,
}: HomeCategoryFilterProps) {
  const handleCategoryClick = (catId: number) => {
    const themesInCategory = themes.filter((t) => t.categoryId === catId);
    if (themesInCategory.length === 0) {
      onCategoryChange(catId, null);
      return;
    }

    const currentThemeInCategory = themesInCategory.find(
      (t) => t.id === themeFilter,
    );
    if (currentThemeInCategory) {
      // Keep existing theme if it's in the new category
      onCategoryChange(catId, themeFilter);
    } else {
      const defaultInCategory = themesInCategory.find((t) => t.isDefault);
      const targetTheme = defaultInCategory || themesInCategory[0];
      onCategoryChange(catId, targetTheme.id);
    }
  };

  const visibleCategories = categories.filter((cat) => {
    if (appMode === 'all') return true;
    if (cat.mode === 'both') return true;
    return cat.mode === appMode;
  });

  return (
    <div className="flex items-center overflow-x-auto scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-600 scrollbar-track-transparent bg-slate-50 dark:bg-slate-800/50">
      {visibleCategories.map((cat) => {
        const CatIcon = getIconComponent(cat.icon || '') || FolderKanban;
        const isActive = categoryFilter === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => handleCategoryClick(cat.id)}
            className={`relative flex items-center gap-1.5 px-4 py-2 font-mono text-[11px] uppercase tracking-wider transition-all whitespace-nowrap shrink-0 border-r ${
              isActive
                ? 'bg-slate-200 dark:bg-slate-600/70 font-bold border-b-2'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/30'
            } border-slate-200 dark:border-slate-700`}
            style={{
              color: isActive ? cat.color : undefined,
              borderBottomColor: isActive ? cat.color : undefined,
            }}
          >
            <CatIcon className="w-3.5 h-3.5" />
            {cat.name}
            {globalSettings?.defaultCategoryId === cat.id && (
              <Star className="w-2.5 h-2.5 fill-current" />
            )}
          </button>
        );
      })}
    </div>
  );
}
