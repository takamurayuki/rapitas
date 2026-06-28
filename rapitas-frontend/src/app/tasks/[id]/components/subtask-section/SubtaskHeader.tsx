'use client';

/**
 * SubtaskHeader
 *
 * Header row for the SubtaskSection card showing progress stats and bulk action buttons.
 * Owns no state — all callbacks are passed from the parent.
 */

import { ListTodo, ClipboardCheck, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Task } from '@/types';

interface SubtaskHeaderProps {
  subtasks: NonNullable<Task['subtasks']>;
  isSubtaskSelectionMode: boolean;
  selectedSubtaskIds: Set<number>;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  /** @param v - confirmation mode / 確認モード */
  onSetDeleteConfirm: (v: 'all' | 'selected' | null) => void;
}

/**
 * Header bar with subtask count, progress, and bulk action controls.
 *
 * @param props - SubtaskHeaderProps
 */
export function SubtaskHeader({
  subtasks,
  isSubtaskSelectionMode,
  selectedSubtaskIds,
  onToggleSelectionMode,
  onSelectAll,
  onDeselectAll,
  onSetDeleteConfirm,
}: SubtaskHeaderProps) {
  const t = useTranslations('task');

  return (
    <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50">
          {/* ListTodo (matches the quick-nav subtask icon) reads as "subtasks",
              unlike a check mark which implies the section is complete. */}
          <ListTodo className="w-5 h-5 text-indigo-500" />
          <h2 className="text-lg font-bold">{t('subtasks')}</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Bulk select — toggles selection mode, matching the task list's bulk button.
              Outline hidden by default; shown only while selecting. */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelectionMode();
            }}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
              isSubtaskSelectionMode
                ? 'border-purple-400 bg-purple-50 text-purple-700 dark:border-purple-500 dark:bg-purple-900/30 dark:text-purple-300'
                : 'border-transparent text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-900/30'
            }`}
            title={t('bulkSelect')}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            {isSubtaskSelectionMode
              ? t('selecting', { count: selectedSubtaskIds.size })
              : t('bulkSelect')}
          </button>
          {isSubtaskSelectionMode && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (selectedSubtaskIds.size === subtasks.length) {
                    onDeselectAll();
                  } else {
                    onSelectAll();
                  }
                }}
                className="px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                {selectedSubtaskIds.size === subtasks.length ? t('deselectAll') : t('selectAll')}
              </button>
              {selectedSubtaskIds.size > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSetDeleteConfirm('selected');
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-[0_2px_0_0_#fca5a5] dark:shadow-[0_2px_0_0_#7f1d1d] hover:bg-red-50 dark:hover:bg-red-900/30 active:translate-y-[1px] active:shadow-none transition-all duration-75"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {t('deleteCount', { count: selectedSubtaskIds.size })}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
