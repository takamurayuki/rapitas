/**
 * pomodoroFloatControls
 *
 * Minimal control row for the Pomodoro floating window: Pause/Resume and
 * Checkpoint only. Start/Complete/Cancel are intentionally absent — those
 * require task/subtask/actualHours context the float window doesn't carry
 * (see plan.md "設計判断の根拠"). Reuses PomodoroTimerControls' tint
 * palette for visual consistency without importing that component's props
 * contract, which doesn't fit this reduced scope.
 */
'use client';

import { Play, Pause, AlarmClockPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface PomodoroFloatControlsProps {
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  onCheckpoint: () => void;
}

const TINT_BASE =
  'flex items-center justify-center rounded-lg p-2.5 transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
const TINT_INDIGO =
  'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 ' +
  'dark:bg-indigo-500/15 dark:text-indigo-400 dark:hover:bg-indigo-500/25';
const TINT_ZINC =
  'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 ' +
  'dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200';

export default function PomodoroFloatControls({
  isPaused,
  onPause,
  onResume,
  onCheckpoint,
}: PomodoroFloatControlsProps) {
  const t = useTranslations('pomodoro');

  return (
    <div className="flex justify-center gap-3">
      {isPaused ? (
        <button
          type="button"
          onClick={onResume}
          className={`${TINT_BASE} ${TINT_INDIGO}`}
          aria-label={t('resumeWork')}
          title={t('resumeWork')}
        >
          <Play className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onPause}
          className={`${TINT_BASE} ${TINT_INDIGO}`}
          aria-label={t('pause')}
          title={t('pause')}
        >
          <Pause className="h-5 w-5" />
        </button>
      )}
      <button
        type="button"
        onClick={onCheckpoint}
        className={`${TINT_BASE} ${TINT_ZINC}`}
        aria-label={t('checkpointButton')}
        title={t('checkpointTooltip')}
      >
        <AlarmClockPlus className="h-5 w-5" />
      </button>
    </div>
  );
}
