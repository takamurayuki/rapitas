'use client';

/**
 * SubtaskHeader
 *
 * Header row for the SubtaskSection card showing progress stats and bulk action buttons.
 * Owns no state — all callbacks are passed from the parent.
 */

import { ListTodo, ListChecks, Trash2 } from 'lucide-react';
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

        {/* Bulk controls only make sense with subtasks to select. */}
        {subtasks.length > 0 && (
          <div className="flex items-center gap-2">
            {isSubtaskSelectionMode && (
              <>
                {/* 全選択 — フラット。タスク一覧の HomeToolbar と同じ視覚言語。 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selectedSubtaskIds.size === subtasks.length) {
                      onDeselectAll();
                    } else {
                      onSelectAll();
                    }
                  }}
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg select-none text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
                >
                  {selectedSubtaskIds.size === subtasks.length ? t('deselectAll') : t('selectAll')}
                </button>
                {/* 削除 — ボトムリッジ (赤)。 */}
                {selectedSubtaskIds.size > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetDeleteConfirm('selected');
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-[0_2px_0_0_#fca5a5] dark:shadow-[0_2px_0_0_#7f1d1d] hover:bg-red-50 dark:hover:bg-red-900/30 active:translate-y-[1px] active:shadow-none transition-all duration-75"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t('deleteCount', { count: selectedSubtaskIds.size })}
                  </button>
                )}
              </>
            )}
            {/* 一括選択 — ボトムリッジ (紫)。選択モード中は押し込んだまま。
                タスク一覧 (HomeToolbar) の一括ボタンと同じデザイン・同じ ListChecks。 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelectionMode();
              }}
              title={t('bulkSelect')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg select-none text-purple-700 dark:text-purple-300 border transition-all duration-75 ${
                isSubtaskSelectionMode
                  ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700 translate-y-[1px] shadow-none'
                  : 'bg-white dark:bg-zinc-900 border-purple-200 dark:border-purple-800 shadow-[0_2px_0_0_#d8b4fe] dark:shadow-[0_2px_0_0_#4c1d95] hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-300 dark:hover:border-purple-700 active:translate-y-[1px] active:shadow-none'
              }`}
            >
              <ListChecks className="w-3.5 h-3.5" />
              {isSubtaskSelectionMode
                ? t('selecting', { count: selectedSubtaskIds.size })
                : t('bulkSelect')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
