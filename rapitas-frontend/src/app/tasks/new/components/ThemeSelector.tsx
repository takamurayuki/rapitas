/**
 * ThemeSelector
 *
 * Renders a row of colour-coded theme pill buttons for the new-task form.
 * Visibility is pre-filtered by the caller (useNewTaskForm.visibleThemes).
 */
'use client';
import { SwatchBook } from 'lucide-react';
import type { Theme } from '@/types';
import { getIconComponent } from '@/components/category/IconData';

interface ThemeSelectorProps {
  /** Themes already filtered for the current app mode. */
  themes: Theme[];
  /** Currently selected theme ID (null = none). */
  themeId: number | null;
  /** Called when the user clicks a theme pill. */
  onSelect: (theme: Theme) => void;
}

/**
 * Displays colour-coded theme buttons.
 *
 * @param props.themes - Filtered theme list / フィルタ済みテーマリスト
 * @param props.themeId - Active theme ID / 選択中テーマID
 * @param props.onSelect - Selection handler / 選択ハンドラ
 */
export function ThemeSelector({ themes, themeId, onSelect }: ThemeSelectorProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {themes.map((theme) => {
        const ThemeIcon = getIconComponent(theme.icon || '') || SwatchBook;
        const isSelected = themeId === theme.id;
        return (
          <button
            key={theme.id}
            type="button"
            onClick={() => onSelect(theme)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium transition-all ${
              isSelected
                ? 'ring-1 ring-offset-1 ring-offset-white dark:ring-offset-zinc-900'
                : 'opacity-60 hover:opacity-100'
            }`}
            style={
              {
                backgroundColor: isSelected ? theme.color : `${theme.color}20`,
                color: isSelected ? '#fff' : theme.color,
                ['--tw-ring-color' as keyof React.CSSProperties]: theme.color,
              } as React.CSSProperties
            }
          >
            <ThemeIcon className="w-2.5 h-2.5" />
            {theme.name}
          </button>
        );
      })}
    </div>
  );
}
