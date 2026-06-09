'use client';
/**
 * AutoExecutionMode
 *
 * Toolbar toggle for per-theme task auto-execution. Starts/stops the selected
 * development theme's auto-run, which runs that theme's EXISTING todo tasks one
 * at a time (highest priority first, then creation order). This is NOT AI task
 * generation. Rendered only when a development theme is active.
 */
import { Play, Square, Loader2 } from 'lucide-react';
import { useThemeAutoRun } from '@/hooks/workflow/useThemeAutoRun';

interface AutoExecutionModeProps {
  /** Selected development theme to control, or null when none is active. */
  theme?: { id: number; isDevelopment?: boolean } | null;
}

/**
 * Single start/stop control for a theme's task auto-execution.
 *
 * @param props.theme - The active development theme (id + isDevelopment). / 対象の開発テーマ
 * @returns Start/stop toggle button, or null for non-dev themes. / 開始/停止トグル
 */
export function AutoExecutionMode({ theme }: AutoExecutionModeProps) {
  const { data, actionLoading, error, start, stop } = useThemeAutoRun(
    theme?.id ?? null,
    theme?.isDevelopment,
  );

  // Auto-run is a per-development-theme feature — nothing to show otherwise.
  if (!theme?.isDevelopment) return null;

  const status = data?.autoRun?.status ?? 'idle';

  const handleClick = () => {
    if (status === 'idle') start('priority');
    else stop();
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={actionLoading || status === 'stopping'}
        title={
          status === 'idle'
            ? 'このテーマのToDoタスクをAI生成なしで上から順に自動実行します'
            : '自動実行を停止します'
        }
        className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          status === 'idle'
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50'
            : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50'
        }`}
      >
        {actionLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : status === 'idle' ? (
          <Play className="h-4 w-4 fill-current" />
        ) : (
          <Square className="h-4 w-4 fill-current" />
        )}
        {status === 'idle' ? 'タスク自動実行' : '停止'}
      </button>

      {error && (
        <span className="max-w-40 truncate text-xs text-red-600 dark:text-red-400" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
