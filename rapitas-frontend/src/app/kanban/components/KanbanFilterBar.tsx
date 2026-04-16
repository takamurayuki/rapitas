'use client';
// KanbanFilterBar

import { Search, SlidersHorizontal, X, Flag, Tag } from 'lucide-react';
import type { Label } from '@/types';

type Priority = 'low' | 'medium' | 'high' | 'urgent';

interface PriorityConfig {
  label: string;
  color: string;
  bg: string;
}

interface KanbanFilterBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  showFilters: boolean;
  onToggleFilters: () => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  selectedPriorities: Priority[];
  onTogglePriority: (priority: Priority) => void;
  priorityConfig: Record<Priority, PriorityConfig>;
  selectedLabelIds: number[];
  onToggleLabel: (labelId: number) => void;
  labels: Label[];
  filteredCount: number;
  /** i18n helper for common namespace */
  tc: (key: string) => string;
  /** i18n helper for task namespace */
  tt: (key: string) => string;
  /** i18n helper for kanban namespace */
  t: (key: string) => string;
}

/**
 * Complete filter bar including search, filter toggle, priority, and label filters.
 *
 * @param searchQuery - Current search string
 * @param onSearchChange - Search input change handler
 * @param showFilters - Whether filter panel is expanded
 * @param onToggleFilters - Toggle filter panel visibility
 * @param hasActiveFilters - Whether any filter is currently applied
 * @param onClearFilters - Reset all filters
 * @param selectedPriorities - Active priority filter selections
 * @param onTogglePriority - Priority toggle handler
 * @param priorityConfig - Priority label/color config
 * @param selectedLabelIds - Active label filter selections
 * @param onToggleLabel - Label toggle handler
 * @param labels - Available label options
 * @param filteredCount - Number of root tasks matching current filters
 * @param tc - common translation function
 * @param tt - task translation function
 * @param t - kanban translation function
 */
export function KanbanFilterBar({
  searchQuery,
  onSearchChange,
  showFilters,
  onToggleFilters,
  hasActiveFilters,
  onClearFilters,
  selectedPriorities,
  onTogglePriority,
  priorityConfig,
  selectedLabelIds,
  onToggleLabel,
  labels,
  filteredCount,
  tc,
  tt,
  t,
}: KanbanFilterBarProps) {
  return (
    <div className="mb-6 space-y-3">
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={tc('search')}
            className="w-full pl-9 pr-8 py-2 text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700"
            >
              <X className="w-3.5 h-3.5 text-zinc-400" />
            </button>
          )}
        </div>
        {/* Filter Toggle */}
        <button
          onClick={onToggleFilters}
          className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
            showFilters
              ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400'
              : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
        {/* Clear Filters */}
        {hasActiveFilters && (
          <button
            onClick={onClearFilters}
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            {t('clear')}
          </button>
        )}
      </div>

      {/* Filter Options Panel */}
      {showFilters && (
        <div className="p-4 bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 space-y-4">
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
                        isSelected
                          ? 'ring-1 ring-offset-1'
                          : 'opacity-70 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: isSelected
                          ? label.color
                          : `${label.color}20`,
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
      )}

      {/* Results count */}
      {hasActiveFilters && (
        <div className="text-sm text-zinc-500 dark:text-zinc-400">
          {filteredCount}
          {t('tasksFound')}
        </div>
      )}
    </div>
  );
}
