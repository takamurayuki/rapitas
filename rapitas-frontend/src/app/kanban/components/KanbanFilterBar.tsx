'use client';
// KanbanFilterBar

import { Flag, Tag, Layers } from 'lucide-react';
import type { Label, Theme } from '@/types';
import { getIconComponent } from '@/components/category/icon-search';

type Priority = 'low' | 'medium' | 'high' | 'urgent';

interface PriorityConfig {
  label: string;
  color: string;
  bg: string;
}

interface KanbanFilterBarProps {
  /** Whether the panel is expanded (controlled by KanbanWeekNav toggle). */
  showFilters: boolean;
  selectedPriorities: Priority[];
  onTogglePriority: (priority: Priority) => void;
  priorityConfig: Record<Priority, PriorityConfig>;
  selectedLabelIds: number[];
  onToggleLabel: (labelId: number) => void;
  labels: Label[];
  themes: Theme[];
  selectedThemeId: number | null;
  onSelectTheme: (themeId: number | null) => void;
  /** i18n helper for task namespace */
  tt: (key: string) => string;
}

/**
 * Collapsible filter panel for theme, priority, and label filters.
 * The toggle button and clear/count controls live in KanbanWeekNav.
 *
 * @param showFilters - Whether the panel is visible
 * @param selectedPriorities - Active priority filter selections
 * @param onTogglePriority - Priority toggle handler
 * @param priorityConfig - Priority label/color config
 * @param selectedLabelIds - Active label filter selections
 * @param onToggleLabel - Label toggle handler
 * @param labels - Available label options
 * @param themes - Available theme options for theme filter
 * @param selectedThemeId - Currently selected theme ID or null
 * @param onSelectTheme - Theme selection handler (null = all themes)
 * @param tt - task translation function
 */
export function KanbanFilterBar({
  showFilters,
  selectedPriorities,
  onTogglePriority,
  priorityConfig,
  selectedLabelIds,
  onToggleLabel,
  labels,
  themes,
  selectedThemeId,
  onSelectTheme,
  tt,
}: KanbanFilterBarProps) {
  if (!showFilters) return null;

  return (
    <div className="mb-4 p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-4">
      {/* Theme Filter */}
      {themes.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <Layers className="w-4 h-4" />
            テーマ
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onSelectTheme(null)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                selectedThemeId === null
                  ? 'bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 ring-1 ring-current'
                  : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
              }`}
            >
              すべて
            </button>
            {themes.map((theme) => {
              const isSelected = selectedThemeId === theme.id;
              return (
                <button
                  key={theme.id}
                  onClick={() => onSelectTheme(isSelected ? null : theme.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isSelected ? 'ring-1 ring-offset-1 text-white' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: isSelected ? theme.color : `${theme.color}25`,
                    color: isSelected ? '#fff' : theme.color,
                    ['--tw-ring-color' as string]: theme.color,
                  }}
                >
                  {(() => {
                    const Icon = getIconComponent(theme.icon ?? '');
                    return Icon ? <Icon size={12} className="mr-1 flex-shrink-0" /> : null;
                  })()}
                  {theme.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Priority Filter */}
      <div>
        <div className="flex items-center gap-2 mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          <Flag className="w-4 h-4" />
          {tt('priority')}
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(priorityConfig) as Priority[]).map((priority) => {
            const config = priorityConfig[priority];
            const isSelected = selectedPriorities.includes(priority);
            return (
              <button
                key={priority}
                onClick={() => onTogglePriority(priority)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isSelected
                    ? `${config.bg} ${config.color} ring-1 ring-current`
                    : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-600'
                }`}
              >
                {config.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Label Filter */}
      {labels.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <Tag className="w-4 h-4" />
            {tt('labels')}
          </div>
          <div className="flex flex-wrap gap-2">
            {labels.map((label) => {
              const isSelected = selectedLabelIds.includes(label.id);
              return (
                <button
                  key={label.id}
                  onClick={() => onToggleLabel(label.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isSelected ? 'ring-1 ring-offset-1' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{
                    backgroundColor: isSelected ? label.color : `${label.color}20`,
                    color: isSelected ? '#fff' : label.color,
                    ['--tw-ring-color' as string]: label.color,
                  }}
                >
                  {label.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
