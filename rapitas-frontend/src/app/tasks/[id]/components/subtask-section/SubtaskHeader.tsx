'use client';

/**
 * SubtaskHeader
 *
 * Header row for the SubtaskSection card showing progress stats and bulk action buttons.
 * Owns no state — all callbacks are passed from the parent.
 */

import React from 'react';
import { ListTodo, CopyCheck, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Task } from '@/types';
import { getStatusDisplay, renderStatusIcon } from '@/feature/tasks/config/StatusConfig';

interface SubtaskHeaderProps {
  subtasks: NonNullable<Task['subtasks']>;
  isSubtaskSelectionMode: boolean;
  selectedSubtaskIds: Set<number>;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  /** @param v - confirmation mode / 確認モード */
  onSetDeleteConfirm: (v: 'all' | 'selected' | null) => void;
  /** @param status - target status for all selected subtasks / 選択中サブタスクの変更先ステータス */
  onBulkUpdateStatus: (status: string) => void;
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
  onBulkUpdateStatus,
}: SubtaskHeaderProps) {
  const t = useTranslations('task');
  const tc = useTranslations('common');
  // Bulk labels/tooltips reuse the task list's existing keys (home namespace)
  // so both screens read identically.
  const tHome = useTranslations('home');

  const allSelected = subtasks.length > 0 && selectedSubtaskIds.size === subtasks.length;

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
                {/* 一括ステータス変更セグメント — タスク一覧 (HomeToolbar) と同じ。
                    1件以上選択で各セグメントが色付きになりクリック可能。 */}
                <div
                  className={`flex items-stretch overflow-hidden rounded-lg border transition-colors ${
                    selectedSubtaskIds.size > 0
                      ? 'border-slate-300 dark:border-slate-600 shadow-sm'
                      : 'border-slate-200 dark:border-slate-700'
                  } bg-white dark:bg-slate-900/50`}
                >
                  {(['todo', 'in-progress', 'done'] as const).map((status, idx) => {
                    const config = getStatusDisplay(t, status);
                    const enabled = selectedSubtaskIds.size > 0;
                    const enabledClasses =
                      status === 'todo'
                        ? 'bg-zinc-50 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300 hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-700 dark:hover:text-zinc-100 active:bg-zinc-300 dark:active:bg-zinc-600'
                        : status === 'in-progress'
                          ? 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300 hover:bg-blue-100 hover:text-blue-800 dark:hover:bg-blue-900/40 dark:hover:text-blue-200 active:bg-blue-200 dark:active:bg-blue-900/60'
                          : 'bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-300 hover:bg-green-100 hover:text-green-800 dark:hover:bg-green-900/40 dark:hover:text-green-200 active:bg-green-200 dark:active:bg-green-900/60';
                    return (
                      <React.Fragment key={status}>
                        {idx > 0 && (
                          <div
                            className={`w-px shrink-0 ${
                              enabled
                                ? 'bg-slate-300 dark:bg-slate-600'
                                : 'bg-slate-200 dark:bg-slate-700'
                            }`}
                          />
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (enabled) onBulkUpdateStatus(status);
                          }}
                          disabled={!enabled}
                          title={
                            enabled ? tHome('changeToStatus', { status: config.label }) : undefined
                          }
                          className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium transition-colors duration-100 ${
                            enabled
                              ? `cursor-pointer ${enabledClasses}`
                              : 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                          }`}
                        >
                          <span className="h-3.5 w-3.5">{renderStatusIcon(status)}</span>
                          <span>{config.label}</span>
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>
                {/* すべて選択/すべて解除 — フラット。文言・アイコンとも
                    タスク一覧の HomeToolbar と同一。 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (allSelected) {
                      onDeselectAll();
                    } else {
                      onSelectAll();
                    }
                  }}
                  title={allSelected ? tHome('deselectAll') : tHome('selectAll')}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg select-none text-zinc-600 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors duration-150"
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    {allSelected ? (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    ) : (
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4m5 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    )}
                  </svg>
                  {allSelected ? tHome('deselectAll') : tHome('selectAll')}
                </button>
                {/* 削除 — ボトムリッジ (赤)。件数は「選択中 (n件)」側に出るので
                    ラベルは「削除」のみ (タスク一覧と同じ)。 */}
                {selectedSubtaskIds.size > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetDeleteConfirm('selected');
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-zinc-900 text-red-600 dark:text-red-400 shadow-[0_2px_0_0_#fca5a5] dark:shadow-[0_2px_0_0_#7f1d1d] hover:bg-red-50 dark:hover:bg-red-900/30 active:translate-y-[1px] active:shadow-none transition-all duration-75"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {tc('delete')}
                  </button>
                )}
              </>
            )}
            {/* 一括選択 — ボトムリッジ (紫)。選択モード中は押し込んだまま。
                タスク一覧 (HomeToolbar) と同じデザイン。CopyCheck = 一括選択モード
                (ListTodo=サブタスクと紛らわしかった ListChecks から全アプリで移行)。 */}
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
              <CopyCheck className="w-3.5 h-3.5" />
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
