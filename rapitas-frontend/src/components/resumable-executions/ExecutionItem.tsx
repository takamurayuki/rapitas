'use client';
// ExecutionItem

import { Clock, ExternalLink, Loader2, Play, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ResumableExecution } from './types';

interface ExecutionItemProps {
  exec: ResumableExecution;
  isResuming: boolean;
  isDismissing: boolean;
  onResume: (id: number) => void;
  onDismiss: (id: number) => void;
  formatTimeAgo: (dateString: string) => string;
}

/**
 * A single row inside the expanded execution list.
 *
 * @param exec - The execution record to display.
 * @param isResuming - Whether a resume request is in-flight for this execution.
 * @param isDismissing - Whether a dismiss request is in-flight for this execution.
 * @param onResume - Called when the user clicks Resume.
 * @param onDismiss - Called when the user clicks the dismiss (X) button.
 * @param formatTimeAgo - Utility to convert a date string to a relative label.
 */
export function ExecutionItem({
  exec,
  isResuming,
  isDismissing,
  onResume,
  onDismiss,
  formatTimeAgo,
}: ExecutionItemProps) {
  const t = useTranslations('banner');
  const tc = useTranslations('common');

  return (
    <div className="p-3 bg-white/80 dark:bg-zinc-900/80 rounded-xl border border-amber-100 dark:border-amber-800/40 hover:border-amber-200 dark:hover:border-amber-700/60 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <a
              href={`/tasks/${exec.taskId}?showHeader=true`}
              className="font-medium text-sm text-zinc-900 dark:text-zinc-100 hover:text-amber-600 dark:hover:text-amber-400 truncate block transition-colors"
            >
              {exec.taskTitle || `${t('taskPrefix')}${exec.taskId}`}
            </a>

            {(exec.status === 'running' || exec.status === 'waiting_for_input') && (
              <span className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-[9px] font-medium rounded-full">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                {t('runningStatus')}
              </span>
            )}

            {exec.status === 'interrupted' && (
              <span className="shrink-0 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[9px] font-medium rounded-full">
                {t('interruptedStatus')}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-1">
            <Clock className="w-3 h-3 text-zinc-400" />
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {exec.status === 'interrupted'
                ? t('interruptedAt', {
                    time: formatTimeAgo(exec.startedAt || exec.createdAt),
                  })
                : t('startedAt', {
                    time: formatTimeAgo(exec.startedAt || exec.createdAt),
                  })}
            </p>
          </div>
        </div>
      </div>

      {/* Last output preview */}
      {exec.output && (
        <div className="mb-2.5 p-2 bg-zinc-50 dark:bg-zinc-800/60 rounded-lg text-xs font-mono text-zinc-600 dark:text-zinc-400 max-h-14 overflow-hidden line-clamp-2">
          {exec.output.slice(-150)}
        </div>
      )}

      {/* Action row */}
      <div className="flex items-center gap-2">
        {exec.canResume ? (
          <button
            onClick={() => onResume(exec.id)}
            disabled={isResuming}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-linear-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-lg text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
          >
            {isResuming ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {tc('resume')}
          </button>
        ) : null}

        <a
          href={`/tasks/${exec.taskId}?showHeader=true`}
          className={`flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            !exec.canResume
              ? 'flex-1 bg-linear-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white shadow-sm hover:shadow-md'
              : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
          }`}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {t('details')}
        </a>

        <button
          onClick={() => onDismiss(exec.id)}
          disabled={isDismissing}
          className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
          title={tc('close')}
        >
          {isDismissing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
          ) : (
            <X className="w-3.5 h-3.5 text-zinc-400" />
          )}
        </button>
      </div>
    </div>
  );
}
