/**
 * group-themes
 *
 * Turns a flat theme list into the category → theme tree the ThemePicker renders.
 * Pure; owns no filtering by app mode — callers pass the themes already visible.
 */
import type { Category, Theme } from '@/types';

/** One category and the themes under it; `category` is null for the uncategorized tail. */
export interface ThemeGroup {
  category: Category | null;
  themes: Theme[];
}

const bySortOrder = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;

/**
 * Groups themes under their categories, both ordered by sortOrder.
 *
 * Categories with no theme are dropped (nothing to pick there). Themes whose
 * category is missing or unknown go to a trailing group so none disappear.
 *
 * @param themes - Themes the user may pick / 選択対象のテーマ
 * @param categories - All categories / 全カテゴリ
 * @returns Non-empty groups in display order / 表示順の空でないグループ
 */
export function groupThemesByCategory(themes: Theme[], categories: Category[]): ThemeGroup[] {
  const known = new Set(categories.map((c) => c.id));
  const groups: ThemeGroup[] = [...categories]
    .sort(bySortOrder)
    .map((category) => ({
      category,
      themes: themes.filter((t) => t.categoryId === category.id).sort(bySortOrder),
    }))
    .filter((g) => g.themes.length > 0);

  const orphans = themes.filter((t) => t.categoryId == null || !known.has(t.categoryId));
  if (orphans.length > 0) groups.push({ category: null, themes: [...orphans].sort(bySortOrder) });
  return groups;
}
