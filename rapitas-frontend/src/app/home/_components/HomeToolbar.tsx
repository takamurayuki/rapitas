'use client';
// HomeToolbar
import React from 'react';
import { useRouter } from 'next/navigation';
import type { Task } from '@/types';
import TodayTaskProgressBar from '@/components/widgets/TodayTaskProgressBar';
import {
  statusConfig,
  renderStatusIcon,
} from '@/feature/tasks/config/StatusConfig';
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
  onQuickAddToggle,
  onBulkUpdateStatus,
  onBulkDelete,
  onSelectAll,
  onToggleSelectionMode,
}: HomeToolbarProps) {
  const router = useRouter();
  const t = useTranslations('home');
  const tc = useTranslations('common');

  const allSelected =
    selectedTasksSize === paginatedTasks.length && paginatedTasks.length > 0;

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
        {/* Auto-execution mode */}
        <AutoExecutionMode />

        {/* Bulk status change buttons — visible when items are selected */}
        {isSelectionMode && selectedTasksSize > 0 && (
          <div className="relative flex items-center gap-1 px-3 py-1 bg-white dark:bg-slate-900/50 rounded-lg border border-slate-300 dark:border-slate-700 shadow-sm">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-400 mr-2">
              CHANGE STATUS:
            </span>
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
                  {idx > 0 && (
                    <div className="w-px h-5 bg-slate-300 dark:bg-slate-600" />
                  )}
                  <button
                    onClick={() => onBulkUpdateStatus(status)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-all cursor-pointer ${textColorClasses} ${bgHoverClasses}`}
                    title={t('changeToStatus', { status: config.label })}
                  >
                    <span className="w-3.5 h-3.5">
                      {renderStatusIcon(status)}
                    </span>
                    <span className="font-mono text-xs font-black tracking-tight">
                      {config.label}
                    </span>
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
              <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-green-500 dark:hover:border-green-400">
                <button
                  onClick={onQuickAddToggle}
                  className={`flex items-center gap-2 transition-all cursor-pointer ${
                    isQuickAdding
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300'
                  }`}
                  title={`${t('quickAdd')} (Ctrl+Q)`}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  <span className="font-mono text-xs font-black tracking-tight">
                    {t('quickAdd')}
                  </span>
                </button>
              </div>

              <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-blue-500 dark:hover:border-blue-400">
                <button
                  onClick={() => {
                    const themeParam = themeFilter || defaultThemeId;
                    router.push(
                      `/tasks/new${themeParam ? `?themeId=${themeParam}` : ''}`,
                    );
                  }}
                  className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-all cursor-pointer"
                  title={`${t('newTask')} (Ctrl+N)`}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <span className="font-mono text-xs font-black tracking-tight">
                    {t('newTask')}
                  </span>
                </button>
              </div>
            </>
          )}

          {/* Selection mode buttons */}
          {isSelectionMode && (
            <>
              <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-slate-500 dark:hover:border-slate-400">
                <button
                  onClick={onSelectAll}
                  className="flex items-center gap-2 transition-all cursor-pointer text-slate-600 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                  title={allSelected ? t('deselectAndExit') : t('selectAll')}
                >
                  <svg
                    className="w-4 h-4"
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
                  <span className="font-mono text-xs font-black tracking-tight">
                    {allSelected ? t('deselectAll') : t('selectAll')}
                  </span>
                </button>
              </div>

              {selectedTasksSize > 0 && (
                <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-red-500 dark:hover:border-red-400">
                  <button
                    onClick={onBulkDelete}
                    className="flex items-center gap-2 transition-all cursor-pointer text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                    title={t('deleteSelected')}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                    <span className="font-mono text-xs font-black tracking-tight">
                      {tc('delete')}
                    </span>
                  </button>
                </div>
              )}
            </>
          )}

          {/* Bulk selection toggle */}
          <div className="relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-purple-500 dark:hover:border-purple-400">
            <button
              onClick={onToggleSelectionMode}
              className={`flex items-center gap-2 transition-all cursor-pointer ${
                isSelectionMode
                  ? 'text-purple-600 dark:text-purple-400'
                  : 'text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300'
              }`}
              title={t('bulkSelectionMode')}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
              <span className="font-mono text-xs font-black tracking-tight">
                {isSelectionMode
                  ? t('selecting', { count: selectedTasksSize })
                  : t('bulk')}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
