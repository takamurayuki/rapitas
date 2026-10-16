/**
 * pomodoroFloatEmptyState
 *
 * Idle UI for the floating window. Pomodoro sessions are always task-bound
 * and are launched from a task's detail page (operator decision, 2026-09-02
 * — no in-float task picker, no taskless start). This screen shows the task
 * handed over from the task detail page (or the last-used task) with a
 * one-click Start; without one it only points the user at the task detail
 * page.
 */
'use client';

import { Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePomodoroStore, formatTime } from '@/feature/tasks/pomodoro/pomodoro-store';

const TINT_BASE =
  'flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';
const TINT_INDIGO =
  'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 ' +
  'dark:bg-indigo-500/15 dark:text-indigo-400 dark:hover:bg-indigo-500/25';

export default function PomodoroFloatEmptyState() {
  const t = useTranslations('pomodoro');
  // Read lastUsed* directly from the store (not local state) — the task
  // detail page hands its task over via a BroadcastChannel update, which
  // must re-render this already-open window.
  const { lastUsedTaskId, lastUsedTaskTitle, settings, startTimer } = usePomodoroStore();
  const hasTask = lastUsedTaskId !== null;

  return (
    <div className="flex flex-col items-center gap-3">
      {hasTask ? (
        <p
          className="max-w-full truncate px-4 text-center text-sm text-zinc-700 dark:text-zinc-300"
          title={lastUsedTaskTitle ?? undefined}
        >
          {lastUsedTaskTitle || t('taskDefaultName')}
        </p>
      ) : (
        <p className="px-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {t('floatOpenFromTaskDetail')}
        </p>
      )}
      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {formatTime(settings.pomodoroDuration)}
      </p>
      {hasTask && (
        <button
          type="button"
          onClick={() => startTimer(lastUsedTaskId, lastUsedTaskTitle)}
          className={`${TINT_BASE} ${TINT_INDIGO}`}
          title={t('start')}
        >
          <Play className="h-4 w-4" />
          {t('start')}
        </button>
      )}
    </div>
  );
}
