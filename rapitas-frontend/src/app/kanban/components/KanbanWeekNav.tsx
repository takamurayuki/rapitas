'use client';
// KanbanWeekNav

import { ChevronLeft, ChevronRight, Calendar, SlidersHorizontal, X } from 'lucide-react';

interface KanbanWeekNavProps {
  displayText: string;
  onPrev: () => void;
  onNext: () => void;
  onBackToCurrentWeek: () => void;
  prevLabel: string;
  nextLabel: string;
  backLabel: string;
  /** Whether the filter panel is expanded. */
  showFilters: boolean;
  onToggleFilters: () => void;
  /** Whether any filter (search, priority, label) is currently active. */
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  /** Number of root tasks matching current filters (shown when filters are active). */
  filteredCount: number;
  /** kanban namespace translator. */
  t: (key: string) => string;
}

/**
 * Renders the week navigation row for the Kanban board header, including filter
 * toggle, clear, and result count controls immediately to the right of the period.
 *
 * @param displayText - Formatted week range string shown in the centre button
 * @param onPrev - Navigate to previous week / 前の週に移動
 * @param onNext - Navigate to next week / 次の週に移動
 * @param onBackToCurrentWeek - Jump back to current week / 今週に戻る
 * @param prevLabel - Accessible title for the previous button
 * @param nextLabel - Accessible title for the next button
 * @param backLabel - Accessible title for the back-to-current-week button
 * @param showFilters - Filter panel open state
 * @param onToggleFilters - Toggle the filter panel
 * @param hasActiveFilters - Whether any filter is applied
 * @param onClearFilters - Reset all filters
 * @param filteredCount - Visible root task count when filters are active
 * @param t - kanban i18n translator
 */
export function KanbanWeekNav({
  displayText,
  onPrev,
  onNext,
  onBackToCurrentWeek,
  prevLabel,
  nextLabel,
  backLabel,
  showFilters,
  onToggleFilters,
  hasActiveFilters,
  onClearFilters,
  filteredCount,
  t,
}: KanbanWeekNavProps) {
  return (
    <div className="mb-4 flex items-center gap-2">
      {/* Week navigation */}
      <button
        onClick={onPrev}
        className="p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
        title={prevLabel}
      >
        <ChevronLeft className="w-5 h-5" />
      </button>
      <button
        onClick={onBackToCurrentWeek}
        className="px-4 py-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors flex items-center gap-2"
        title={backLabel}
      >
        <Calendar className="w-4 h-4" />
        <span className="text-sm font-medium">{displayText}</span>
      </button>
      <button
        onClick={onNext}
        className="p-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
        title={nextLabel}
      >
        <ChevronRight className="w-5 h-5" />
      </button>

      {/* Divider */}
      <div className="mx-1 w-px h-5 bg-zinc-200 dark:bg-zinc-700 flex-shrink-0" />

      {/* Filter toggle */}
      <button
        onClick={onToggleFilters}
        aria-label={t('toggleFilters')}
        className={`relative flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${
          showFilters
            ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400'
            : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700'
        }`}
      >
        <SlidersHorizontal className="w-4 h-4" />
        {hasActiveFilters && (
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 dark:bg-indigo-400 flex-shrink-0" />
        )}
      </button>

      {/* Clear all filters */}
      {hasActiveFilters && (
        <button
          onClick={onClearFilters}
          className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          {t('clear')}
        </button>
      )}

      {/* Result count */}
      {hasActiveFilters && (
        <span className="text-sm text-zinc-500 dark:text-zinc-500">
          {filteredCount}
          {t('tasksFound')}
        </span>
      )}
    </div>
  );
}
