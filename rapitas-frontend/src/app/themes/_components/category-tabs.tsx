/**
 * CategoryTabs
 *
 * Renders horizontal tab buttons for filtering themes by category.
 * Does not own any data-fetching; all data is passed via props.
 */
import type { Category, Theme } from '@/types';

type Props = {
  categories: Category[];
  items: Theme[];
  selectedCategoryId: number | null;
  onSelectCategory: (id: number) => void;
  renderIcon: (
    iconName: string | null | undefined,
    size?: number,
  ) => React.ReactNode;
};

/**
 * Displays a scrollable row of category filter buttons with item counts.
 *
 * @param props.categories - Full list of categories to display as tabs.
 * @param props.items - All theme items used to compute per-category counts.
 * @param props.selectedCategoryId - Currently active category id.
 * @param props.onSelectCategory - Called when the user clicks a category tab.
 * @param props.renderIcon - Utility to render a Lucide icon by name.
 */
export function CategoryTabs({
  categories,
  items,
  selectedCategoryId,
  onSelectCategory,
  renderIcon,
}: Props) {
  if (categories.length === 0) return null;

  return (
    <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1">
      {categories.map((cat) => {
        const count = items.filter((ti) => ti.categoryId === cat.id).length;
        const isSelected = selectedCategoryId === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => onSelectCategory(cat.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              isSelected
                ? 'text-white shadow-md'
                : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border'
            }`}
            style={
              isSelected
                ? { backgroundColor: cat.color }
                : {
                    color: cat.color,
                    borderColor: cat.color + '60',
                  }
            }
          >
            {renderIcon(cat.icon, 14)}
            {cat.name}
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
