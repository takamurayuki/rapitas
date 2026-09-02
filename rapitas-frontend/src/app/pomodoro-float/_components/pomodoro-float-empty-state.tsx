/**
 * pomodoroFloatEmptyState
 *
 * Idle UI shown in the floating window when no Pomodoro is running: the last
 * used task (or a "no task" label), the configured duration, and a Start
 * button — replacing the former one-line message that looked blank in
 * transparent/small-window rendering (plan.md データモデル — lastUsedTaskId).
 * Starting here always resumes the last used task (or a taskless session);
 * the float window has no task picker of its own.
 */
'use client';

import { Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePomodoroStore, formatTime } from '@/feature/tasks/pomodoro/pomodoro-store';

const TINT_BASE =
  'flex items-center justify-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const TINT_INDIGO =
  'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 ' +
  'dark:bg-indigo-500/15 dark:text-indigo-400 dark:hover:bg-indigo-500/25';

export default function PomodoroFloatEmptyState() {
  const t = useTranslations('pomodoro');
  const { lastUsedTaskId, lastUsedTaskTitle, settings, startTimer } = usePomodoroStore();

  const taskLabel =
    lastUsedTaskId !== null ? (lastUsedTaskTitle ?? t('taskDefaultName')) : t('floatNoTaskLabel');

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-center text-sm text-zinc-700 dark:text-zinc-300">{taskLabel}</p>
      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {formatTime(settings.pomodoroDuration)}
      </p>
      <button
        type="button"
        onClick={() => startTimer(lastUsedTaskId, lastUsedTaskTitle)}
        className={`${TINT_BASE} ${TINT_INDIGO}`}
        title={t('start')}
      >
        <Play className="h-4 w-4" />
        {t('start')}
      </button>
    </div>
  );
}
