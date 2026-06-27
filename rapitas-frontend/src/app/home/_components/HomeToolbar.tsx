'use client';
// HomeToolbar
import React from 'react';
import { useRouter } from 'next/navigation';
import type { Task } from '@/types';
import TodayTaskProgressBar from '@/components/widgets/TodayTaskProgressBar';
import { statusConfig, renderStatusIcon } from '@/feature/tasks/config/StatusConfig';
import { useTranslations } from 'next-intl';
import { AutoExecutionMode } from './AutoExecutionMode';

interface HomeToolbarProps {
  completedTasksCount: number;
  totalTasksCount: number;
  isSelectionMode: boolean;
  selectedTasksSize: number;
  paginatedTasks: Task[];
  isQuickAdding: boolean;
  themeFilter: number | null;
  defaultThemeId: number | undefined;
  /** Active development theme for the auto-execution toggle (null otherwise). */
  autoRunTheme: { id: number; isDevelopment?: boolean } | null;
  onQuickAddToggle: () => void;
  onBulkUpdateStatus: (status: string) => void;
  onBulkDelete: () => void;
  onSelectAll: () => void;
  onToggleSelectionMode: () => void;
}

/**
 * Top toolbar for the home page with task actions and selection controls.
 *
 * @param props - Toolbar state and callbacks.
 * @returns The toolbar JSX.
 */
export function HomeToolbar({
  completedTasksCount,
  totalTasksCount,
  isSelectionMode,
  selectedTasksSize,
  paginatedTasks,
  isQuickAdding,
  themeFilter,
  defaultThemeId,
  autoRunTheme,
  onQuickAddToggle,
  onBulkUpdateStatus,
  onBulkDelete,
  onSelectAll,
  onToggleSelectionMode,
}: HomeToolbarProps) {
  const router = useRouter();
  const t = useTranslations('home');
  const tc = useTranslations('common');

  const allSelected = selectedTasksSize === paginatedTasks.length && paginatedTasks.length > 0;

  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <TodayTaskProgressBar
          completedCount={completedTasksCount}
          totalCount={totalTasksCount}
          compact={true}
          className="w-52"
        />
      </div>

      <div className="flex items-center gap-3">
        {/* Auto-execution toggle — hidden during bulk selection */}
        {!isSelectionMode && <AutoExecutionMode theme={autoRunTheme} />}

        {/* Bulk status change buttons — visible when items are selected */}
        {isSelectionMode && selectedTasksSize > 0 && (
          <div className="relative flex items-center gap-1 px-3 py-1 bg-white dark:bg-slate-900/50 rounded-lg border border-slate-300 dark:border-slate-700 shadow-sm">
            {(['todo', 'in-progress', 'done'] as const).map((status, idx) => {
              const config = statusConfig[status];
              const textColorClasses =
                status === 'todo'
                  ? 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300'
                  : status === 'in-progress'
                    ? 'text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300'
                    : 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300';

              const bgHoverClasses =
                status === 'todo'
                  ? 'hover:bg-zinc-100 dark:hover:bg-zinc-900/30'
                  : status === 'in-progress'
                    ? 'hover:bg-blue-100 dark:hover:bg-blue-900/30'
                    : 'hover:bg-green-100 dark:hover:bg-green-900/30';

              return (
                <React.Fragment key={status}>
                  {idx > 0 && <div className="w-px h-5 bg-slate-300 dark:bg-slate-600" />}
                  <button
                    onClick={() => onBulkUpdateStatus(status)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-all cursor-pointer ${textColorClasses} ${bgHoverClasses}`}
                    title={t('changeToStatus', { status: config.label })}
                  >
                    <span className="w-3.5 h-3.5">{renderStatusIcon(status)}</span>
                    <span className="text-sm font-medium">{config.label}</span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          {/* Normal mode buttons */}
          {!isSelectionMode && (
            <>
              {/* クイック追加 — ソリッドデプス (緑) */}
              <button
                onClick={onQuickAddToggle}
                title={`${t('quickAdd')} (Ctrl+Q)`}
                className={`
                  flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
                  text-sm font-semibold text-white transition-all duration-75
                  ${
                    isQuickAdding
                      ? 'bg-green-600 dark:bg-green-700 shadow-none translate-y-[3px]'
                      : 'bg-green-500 dark:bg-green-600 shadow-[0_3px_0_0_#15803d] dark:shadow-[0_3px_0_0_#14532d] hover:bg-green-400 dark:hover:bg-green-500 active:translate-y-[3px] active:shadow-none active:bg-green-600 dark:active:bg-green-700'
                  }
                `}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                {t('quickAdd')}
              </button>

              {/* 新規タスク — ソリッドデプス (青) */}
              <button
                onClick={() => {
                  const themeParam = themeFilter || defaultThemeId;
                  router.push(`/tasks/new${themeParam ? `?themeId=${themeParam}` : ''}`);
                }}
                title={`${t('newTask')} (Ctrl+N)`}
                className="
                  flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
                  text-sm font-semibold text-white
                  bg-blue-500 dark:bg-blue-600
                  shadow-[0_3px_0_0_#1d4ed8] dark:shadow-[0_3px_0_0_#1e3a5f]
                  transition-all duration-75
                  hover:bg-blue-400 dark:hover:bg-blue-500
                  active:translate-y-[3px] active:shadow-none active:bg-blue-600 dark:active:bg-blue-700
                "
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                {t('newTask')}
              </button>
            </>
          )}

          {/* Selection mode buttons */}
          {isSelectionMode && (
            <>
              {/* 全選択 — ソリッドデプス (zinc) */}
              <button
                onClick={onSelectAll}
                title={allSelected ? t('deselectAndExit') : t('selectAll')}
                className="
                  flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
                  text-sm font-semibold text-white
                  bg-zinc-500 dark:bg-zinc-600
                  shadow-[0_3px_0_0_#3f3f46] dark:shadow-[0_3px_0_0_#18181b]
                  transition-all duration-75
                  hover:bg-zinc-400 dark:hover:bg-zinc-500
                  active:translate-y-[3px] active:shadow-none active:bg-zinc-600 dark:active:bg-zinc-700
                "
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                {allSelected ? t('deselectAll') : t('selectAll')}
              </button>

              {/* 削除 — ソリッドデプス (赤) */}
              {selectedTasksSize > 0 && (
                <button
                  onClick={onBulkDelete}
                  title={t('deleteSelected')}
                  className="
                    flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
                    text-sm font-semibold text-white
                    bg-red-500 dark:bg-red-600
                    shadow-[0_3px_0_0_#b91c1c] dark:shadow-[0_3px_0_0_#7f1d1d]
                    transition-all duration-75
                    hover:bg-red-400 dark:hover:bg-red-500
                    active:translate-y-[3px] active:shadow-none active:bg-red-600 dark:active:bg-red-700
                  "
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  {tc('delete')}
                </button>
              )}
            </>
          )}

          {/* 一括 — ソリッドデプス (紫)。選択モード中は押し込んだまま */}
          <button
            onClick={onToggleSelectionMode}
            title={t('bulkSelectionMode')}
            className={`
              flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
              text-sm font-semibold text-white transition-all duration-75
              ${
                isSelectionMode
                  ? 'bg-purple-600 dark:bg-purple-700 shadow-none translate-y-[3px]'
                  : 'bg-purple-500 dark:bg-purple-600 shadow-[0_3px_0_0_#7e22ce] dark:shadow-[0_3px_0_0_#3b0764] hover:bg-purple-400 dark:hover:bg-purple-500 active:translate-y-[3px] active:shadow-none active:bg-purple-600 dark:active:bg-purple-700'
              }
            `}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
            {isSelectionMode ? t('selecting', { count: selectedTasksSize }) : t('bulk')}
          </button>
        </div>
      </div>
    </div>
  );
}
