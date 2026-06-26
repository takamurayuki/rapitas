/**
 * ThemeTabs (labels page)
 *
 * Horizontal filter tabs for selecting which theme's labels to display.
 * Receives themes already filtered by the selected category.
 * Shows theme icon, ☆ for the default theme, and label count.
 */
import { Star } from 'lucide-react';
import type { Theme } from '@/types';
import type { LabelItem } from '../_hooks/useLabelsPage';

type Props = {
  themes: Theme[];
  labels: LabelItem[];
  selectedThemeId: number | null;
  onSelectTheme: (id: number) => void;
  renderIcon: (iconName: string | null | undefined, size?: number) => React.ReactNode;
};

/**
 * Renders a scrollable row of theme filter buttons with label counts.
 *
 * @param props.themes - Themes to display (pre-filtered by selected category).
 * @param props.labels - All labels, used to compute per-theme counts.
 * @param props.selectedThemeId - Currently selected theme id.
 * @param props.onSelectTheme - Called when the user clicks a theme tab.
 * @param props.renderIcon - Utility to render a Lucide icon by name.
 */
export function ThemeTabs({ themes, labels, selectedThemeId, onSelectTheme, renderIcon }: Props) {
  if (themes.length === 0) return null;

  return (
    <div className="mb-4 flex items-center gap-1.5 overflow-x-auto pb-1">
      {themes.map((theme) => {
        const count = labels.filter((l) => l.themeId === theme.id).length;
        const isSelected = selectedThemeId === theme.id;
        return (
          <button
            key={theme.id}
            onClick={() => onSelectTheme(theme.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
              isSelected
                ? 'text-white shadow-md'
                : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 border'
            }`}
            style={
              isSelected
                ? { backgroundColor: theme.color }
                : { color: theme.color, borderColor: theme.color + '60' }
            }
          >
            {renderIcon(theme.icon, 13)}
            {theme.name}
            {theme.isDefault && (
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
