'use client';
// HomeToolbar
import React from 'react';
import { useRouter } from 'next/navigation';
import { ListPlus, CopyCheck, CircleCheckBig, X } from 'lucide-react';
import type { Task } from '@/types';
import TodayTaskProgressBar from '@/components/widgets/TodayTaskProgressBar';
import { getStatusDisplay, renderStatusIcon } from '@/feature/tasks/config/StatusConfig';
import { useTranslations } from 'next-intl';
import { AutoExecutionMode } from './AutoExecutionMode';

interface HomeToolbarProps {
  completedTasksCount: number;
  totalTasksCount: number;
  /** Whether the currently displayed (filtered) task list has any task. When false,
      the right-side action group is hidden while the progress bar stays. */
  hasVisibleTasks: boolean;
  isSelectionMode: boolean;
  selectedTasksSize: number;
  paginatedTasks: Task[];
  themeFilter: number | null;
  defaultThemeId: number | undefined;
  /** Active development theme for the auto-execution toggle (null otherwise). */
  autoRunTheme: { id: number; isDevelopment?: boolean } | null;
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
  completedTasksCount: _completedTasksCount,
  totalTasksCount: _totalTasksCount,
  hasVisibleTasks,
  isSelectionMode,
  selectedTasksSize,
  paginatedTasks,
  themeFilter,
  defaultThemeId,
  autoRunTheme,
  onBulkUpdateStatus,
  onBulkDelete,
  onSelectAll,
  onToggleSelectionMode,
}: HomeToolbarProps) {
  const router = useRouter();
  const t = useTranslations('home');
  const tc = useTranslations('common');
  const tt = useTranslations('task');

  const allSelected = selectedTasksSize === paginatedTasks.length && paginatedTasks.length > 0;

  return (
    <div className="mb-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <TodayTaskProgressBar compact={true} className="w-60" />
      </div>

      {/* Right-side action group (auto-exec / create / bulk). Hidden when the
          visible task list is empty so it doesn't sit beside an empty list. */}
      {hasVisibleTasks && (
        <div className="flex items-center gap-3">
          {/* Auto-execution toggle — hidden during bulk selection */}
          {!isSelectionMode && <AutoExecutionMode theme={autoRunTheme} />}

          {/* Bulk status segmented control — always visible in selection mode.
            Segments are coloured and clickable once ≥1 task is selected. */}
          {isSelectionMode && (
            <div
              className={`flex h-[38px] items-stretch overflow-hidden rounded-lg border transition-colors ${
                selectedTasksSize > 0
                  ? 'border-slate-300 dark:border-slate-600 shadow-sm'
                  : 'border-slate-200 dark:border-slate-700'
              } bg-white dark:bg-slate-900/50`}
            >
              {(['todo', 'in-progress', 'done'] as const).map((status, idx) => {
                const config = getStatusDisplay(tt, status);
                const enabled = selectedTasksSize > 0;

                // When enabled: each segment shows its status tint immediately so
                // the user can see "these are clickable buttons" at a glance.
                // Hover deepens the tint; active shifts down slightly.
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
                      onClick={() => enabled && onBulkUpdateStatus(status)}
                      disabled={!enabled}
                      title={enabled ? t('changeToStatus', { status: config.label }) : undefined}
                      className={`flex items-center gap-1.5 px-3 text-sm font-medium transition-colors duration-100 ${
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
          )}

          <div className="flex items-center gap-3">
            {/* Normal mode buttons */}
            {!isSelectionMode && (
              <>
                {/* タスクを作成 — ボトムリッジ (青) */}
                <button
                  onClick={() => {
                    const themeParam = themeFilter || defaultThemeId;
                    router.push(`/tasks/new${themeParam ? `?themeId=${themeParam}` : ''}`);
                  }}
                  title={`${t('createTask')} (Ctrl+N)`}
                  className="
                  flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
                  text-sm font-medium text-blue-700 dark:text-blue-300
                  bg-white dark:bg-zinc-900
                  border border-blue-200 dark:border-blue-800
                  shadow-[0_2px_0_0_#93c5fd] dark:shadow-[0_2px_0_0_#1e3a8a]
                  transition-all duration-75
                  hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:border-blue-300 dark:hover:border-blue-700
                  active:translate-y-[2px] active:shadow-none active:bg-blue-50 dark:active:bg-blue-900/20
                "
                >
                  <ListPlus className="w-4 h-4" />
                  {t('createTask')}
                </button>
              </>
            )}

            {/* Selection mode buttons */}
            {isSelectionMode && (
              <>
                {/* 全選択 — フラット (表示補助操作のため) */}
                <button
                  onClick={onSelectAll}
                  title={allSelected ? t('deselectAndExit') : t('selectAll')}
                  className="
                  flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
                  text-sm font-medium text-zinc-600 dark:text-zinc-400
                  bg-zinc-100 dark:bg-zinc-800
                  transition-colors duration-150
                  hover:bg-zinc-200 dark:hover:bg-zinc-700
                "
                >
                  {/* CircleCheckBig — properly centred check; the hand-rolled
                      check-circle path drifted at small sizes. Same glyph as the
                      subtask header's select-all. */}
                  {allSelected ? <X className="w-4 h-4" /> : <CircleCheckBig className="w-4 h-4" />}
                  {allSelected ? t('deselectAll') : t('selectAll')}
                </button>

                {/* 削除 — ボトムリッジ (赤) */}
                {selectedTasksSize > 0 && (
                  <button
                    onClick={onBulkDelete}
                    title={t('deleteSelected')}
                    className="
                    flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
                    text-sm font-medium text-red-600 dark:text-red-400
                    bg-white dark:bg-zinc-900
                    border border-red-200 dark:border-red-800
                    shadow-[0_2px_0_0_#fca5a5] dark:shadow-[0_2px_0_0_#7f1d1d]
                    transition-all duration-75
                    hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-700
                    active:translate-y-[2px] active:shadow-none active:bg-red-50 dark:active:bg-red-900/20
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

            {/* 一括選択 — ボトムリッジ (紫)。選択モード中は押し込んだまま。
              CopyCheck = 複数項目の選択を直感的に表す (旧 ListChecks は ListTodo=
              サブタスクと似ていて紛らわしかったため全アプリで移行)。 */}
            <button
              onClick={onToggleSelectionMode}
              title={t('bulkSelectionMode')}
              className={`
              flex items-center gap-2 px-3.5 py-2 rounded-lg select-none
              text-sm font-medium text-purple-700 dark:text-purple-300
              border transition-all duration-75
              ${
                isSelectionMode
                  ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-300 dark:border-purple-700 translate-y-[2px] shadow-none'
                  : 'bg-white dark:bg-zinc-900 border-purple-200 dark:border-purple-800 shadow-[0_2px_0_0_#d8b4fe] dark:shadow-[0_2px_0_0_#4c1d95] hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-300 dark:hover:border-purple-700 active:translate-y-[2px] active:shadow-none active:bg-purple-50 dark:active:bg-purple-900/20'
              }
            `}
            >
              <CopyCheck className="w-4 h-4" />
              {isSelectionMode ? t('selecting', { count: selectedTasksSize }) : t('bulk')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
