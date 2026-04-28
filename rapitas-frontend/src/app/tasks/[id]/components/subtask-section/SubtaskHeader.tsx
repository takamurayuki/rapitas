'use client';

/**
 * SubtaskHeader
 *
 * Header row for the SubtaskSection card showing progress stats and bulk action buttons.
 * Owns no state — all callbacks are passed from the parent.
 */

import { CheckCircle2, CheckSquare, Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Task } from '@/types';

interface SubtaskHeaderProps {
  subtasks: NonNullable<Task['subtasks']>;
  doneCount: number;
  progressPercent: number;
  isSubtaskSelectionMode: boolean;
  selectedSubtaskIds: Set<number>;
  onToggleAddSubtask: () => void;
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
  doneCount,
  progressPercent,
  isSubtaskSelectionMode,
  selectedSubtaskIds,
  onToggleAddSubtask,
  onToggleSelectionMode,
  onSelectAll,
  onDeselectAll,
  onSetDeleteConfirm,
}: SubtaskHeaderProps) {
  const t = useTranslations('task');
  const hasSubtasks = subtasks.length > 0;

  return (
    <div className="p-4 border-b border-zinc-100 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50 flex-1">
          <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          <h2 className="text-lg font-bold">{t('subtasks')}</h2>
          {hasSubtasks ? (
            <>
              <span className="ml-1 px-2 py-0.5 text-xs font-medium bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-full">
                {doneCount}/{subtasks.length}
              </span>
              <div className="hidden sm:flex items-center gap-2 ml-2">
                <div className="w-24 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-500">{progressPercent}%</span>
              </div>
            </>
          ) : (
            <>
              <span className="ml-1 px-2 py-0.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 rounded-full">
                0
              </span>
              <div className="hidden sm:flex items-center gap-2 ml-2">
                <div className="w-24 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden" />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleAddSubtask();
            }}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded-lg transition-colors"
            title={t('addSubtask')}
          >
            <Plus className="w-3.5 h-3.5" />
            {t('addSubtask')}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelectionMode();
            }}
            className={`flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg transition-colors ${
              isSubtaskSelectionMode
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
            }`}
          >
            {isSubtaskSelectionMode ? (
              <>
                <X className="w-3.5 h-3.5" />
                {t('deselect')}
              </>
            ) : (
              <>
                <CheckSquare className="w-3.5 h-3.5" />
                {t('select')}
              </>
            )}
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
                  className="flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-red-500 dark:hover:border-red-400 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="font-mono text-xs font-black tracking-tight">
                    {t('deleteCount', { count: selectedSubtaskIds.size })}
                  </span>
                </button>
              )}
            </>
          )}
          {!isSubtaskSelectionMode && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSetDeleteConfirm('all');
              }}
              className="flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-red-500 dark:hover:border-red-400 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span className="font-mono text-xs font-black tracking-tight">{t('deleteAll')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
