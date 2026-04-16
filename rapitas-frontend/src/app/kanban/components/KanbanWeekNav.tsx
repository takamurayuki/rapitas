'use client';
// KanbanWeekNav

import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';

interface KanbanWeekNavProps {
  displayText: string;
  onPrev: () => void;
  onNext: () => void;
  onBackToCurrentWeek: () => void;
  prevLabel: string;
  nextLabel: string;
  backLabel: string;
}

/**
 * Renders the week navigation row for the Kanban board header.
 *
 * @param displayText - Formatted week range string shown in the centre button
 * @param onPrev - Navigate to previous week / 前の週に移動
 * @param onNext - Navigate to next week / 次の週に移動
 * @param onBackToCurrentWeek - Jump back to current week / 今週に戻る
 * @param prevLabel - Accessible title for the previous button
 * @param nextLabel - Accessible title for the next button
 * @param backLabel - Accessible title for the back-to-current-week button
 */
export function KanbanWeekNav({
  displayText,
  onPrev,
  onNext,
  onBackToCurrentWeek,
  prevLabel,
  nextLabel,
  backLabel,
}: KanbanWeekNavProps) {
  return (
    <div className="mb-6 flex items-center justify-between">
      <div className="flex items-center gap-2">
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
      </div>
    </div>
  );
}
