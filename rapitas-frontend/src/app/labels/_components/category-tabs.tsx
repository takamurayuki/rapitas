/**
 * CategoryTabs (labels page)
 *
 * Horizontal tab row for selecting the active category.
 * Shows category icon, ☆ for default categories, and label count.
 */
import { Star } from 'lucide-react';
import type { Category, Theme } from '@/types';
import type { LabelItem } from '../_hooks/useLabelsPage';

type Props = {
  categories: Category[];
  themes: Theme[];
  labels: LabelItem[];
  selectedCategoryId: number | null;
  onSelectCategory: (id: number) => void;
  renderIcon: (iconName: string | null | undefined, size?: number) => React.ReactNode;
};

/**
 * Renders a scrollable row of category filter buttons with label counts.
 *
 * @param props.categories - All categories.
 * @param props.themes - All themes (used to resolve label → category).
 * @param props.labels - All labels (used to compute per-category counts).
 * @param props.selectedCategoryId - Currently selected category id.
 * @param props.onSelectCategory - Called when the user clicks a tab.
 * @param props.renderIcon - Utility to render a Lucide icon by name.
 */
export function CategoryTabs({
  categories,
  themes,
  labels,
  selectedCategoryId,
  onSelectCategory,
  renderIcon,
}: Props) {
  if (categories.length === 0) return null;

  const themeCategoryMap = new Map(themes.map((t) => [t.id, t.categoryId]));

  return (
    <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-1">
      {categories.map((cat) => {
        const count = labels.filter(
          (l) => l.themeId != null && themeCategoryMap.get(l.themeId) === cat.id,
        ).length;
        const isSelected = selectedCategoryId === cat.id;

        return (
          <button
            key={cat.id}
            onClick={() => onSelectCategory(cat.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
              isSelected
                ? 'text-white shadow-md'
                : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border'
            }`}
            style={
              isSelected
                ? { backgroundColor: cat.color }
                : { color: cat.color, borderColor: cat.color + '60' }
            }
          >
            {renderIcon(cat.icon, 13)}
            {cat.name}
            {cat.isDefault && (
              <Star
                className={`w-3 h-3 fill-current ${isSelected ? 'opacity-80' : 'opacity-70'}`}
              />
            )}
            <span
              className={`text-xs px-1 py-0.5 rounded-full ${
                isSelected
                  ? 'bg-white/20 text-white'
                  : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
