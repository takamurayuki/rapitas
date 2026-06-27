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
              {/*
               * Design A — "ボトムリッジ" (Bottom Ridge)
               * 押すと底の段差が消えて2px沈み込む クラシックな押し心地
               */}
              <button
                onClick={onQuickAddToggle}
                title={`${t('quickAdd')} (Ctrl+Q)`}
                className={`
                  flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
                  text-sm font-medium text-green-700 dark:text-green-300
                  border border-green-200 dark:border-green-800
                  shadow-[0_2px_0_0_#86efac] dark:shadow-[0_2px_0_0_#166534]
                  transition-all duration-75
                  hover:bg-green-50 dark:hover:bg-green-900/20 hover:border-green-300 dark:hover:border-green-700
                  active:translate-y-[2px] active:shadow-none active:bg-green-100 dark:active:bg-green-900/30
                  ${isQuickAdding ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 translate-y-[2px] shadow-none' : 'bg-white dark:bg-zinc-900'}
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

              {/*
               * Design B — "ソリッドデプス" (Solid Depth)
               * 青べた塗り＋底に3px影。押すと3px落ちて影消滅、カチッと落ちる感触
               */}
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
              <button
                onClick={onSelectAll}
                title={allSelected ? t('deselectAndExit') : t('selectAll')}
                className="
                  flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
                  text-sm font-medium text-zinc-600 dark:text-zinc-400
                  bg-white dark:bg-zinc-900
                  border border-zinc-200 dark:border-zinc-700
                  shadow-[0_2px_0_0_#d1d5db] dark:shadow-[0_2px_0_0_#374151]
                  transition-all duration-75
                  hover:bg-zinc-50 dark:hover:bg-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-600
                  active:translate-y-[2px] active:shadow-none
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

              {selectedTasksSize > 0 && (
                <button
                  onClick={onBulkDelete}
                  title={t('deleteSelected')}
                  className="
                    flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
                    text-sm font-medium text-red-600 dark:text-red-400
                    bg-white dark:bg-zinc-900
                    border border-red-200 dark:border-red-900
                    shadow-[0_2px_0_0_#fca5a5] dark:shadow-[0_2px_0_0_#7f1d1d]
                    transition-all duration-75
                    hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-800
                    active:translate-y-[2px] active:shadow-none active:bg-red-100 dark:active:bg-red-900/30
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

          {/*
           * Design C — "マイクロスケール" (Micro Scale)
           * 押すとわずかに縮む(scale 97%)＋インナーシャドウで指で押し込む感触
           */}
          <button
            onClick={onToggleSelectionMode}
            title={t('bulkSelectionMode')}
            className={`
              flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
              text-sm font-medium
              border transition-all duration-75
              active:scale-[0.96] active:shadow-[inset_0_2px_4px_rgba(88,28,135,0.2)] dark:active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.4)]
              ${
                isSelectionMode
                  ? 'text-purple-700 dark:text-purple-200 bg-purple-100 dark:bg-purple-900/40 border-purple-300 dark:border-purple-700 shadow-[inset_0_1px_3px_rgba(88,28,135,0.15)]'
                  : 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30 hover:border-purple-300 dark:hover:border-purple-700'
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
