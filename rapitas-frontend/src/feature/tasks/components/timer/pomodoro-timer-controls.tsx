/**
 * pomodoroTimerControls
 *
 * Control row for the Pomodoro timer (start / pause / resume / checkpoint /
 * complete / cancel). Extracted from PomodoroTimer.tsx to keep that file
 * under the project's file-size limit.
 *
 * Visual grammar (operator-approved, 2026-09-02): soft-tint faces for the
 * two state-changing actions (start/pause = indigo tint, complete = green
 * tint), ring-ghost squares for checkpoint/cancel. No solid fills — tinted
 * faces carry the priority without shouting. Idle state shows one LABELED
 * wide start button (a lone small icon read as sparse).
 */
'use client';
import { Play, Pause, Square, Check, AlarmClockPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface PomodoroTimerControlsProps {
  isBreakTime: boolean;
  isTimerRunning: boolean;
  isPaused: boolean;
  isOtherTaskRunning: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onComplete: () => void;
  onStop: () => void;
  onCheckpoint: () => void;
  onCutBreak: () => void;
}

// Soft-tint squares: pale face + saturated stroked glyph, no border.
// Matches IconButton lg metrics (p-2.5, h-5 w-5 glyph).
const TINT_BASE =
  'flex items-center justify-center rounded-lg transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';
const TINT_INDIGO =
  'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 ' +
  'dark:bg-indigo-500/15 dark:text-indigo-400 dark:hover:bg-indigo-500/25';
// Green (not emerald) per ui-design-language: success/completed = green.
const TINT_GREEN =
  'bg-green-50 text-green-600 hover:bg-green-100 ' +
  'dark:bg-green-500/15 dark:text-green-400 dark:hover:bg-green-500/25';
// Neutral tint: same face language as the colored actions, hue carries the
// priority (saturated = state-changing, zinc = auxiliary).
const TINT_ZINC =
  'bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-700 ' +
  'dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200';

export default function PomodoroTimerControls({
  isBreakTime,
  isTimerRunning,
  isPaused,
  isOtherTaskRunning,
  onStart,
  onPause,
  onResume,
  onComplete,
  onStop,
  onCheckpoint,
  onCutBreak,
}: PomodoroTimerControlsProps) {
  const t = useTranslations('pomodoro');

  // Break-time row (operator request 2026-09-03): a break used to hide every
  // control — resume-early and end-session must stay reachable.
  if (isBreakTime) {
    return (
      <div className="flex gap-3 justify-center">
        <button
          type="button"
          onClick={onCutBreak}
          className={`${TINT_BASE} ${TINT_INDIGO} p-2.5`}
          aria-label={t('resumeWork')}
          title={t('resumeWork')}
        >
          <Play className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={onStop}
          className={`${TINT_BASE} ${TINT_ZINC} p-2.5`}
          aria-label={t('cancel')}
          title={t('cancelTooltip')}
        >
          <Square className="h-5 w-5" />
        </button>
      </div>
    );
  }

  if (!isTimerRunning) {
    return (
      <div className="flex gap-3 justify-center">
        {/* Idle: a single small icon read as sparse — give start a label and
            width so the resting state feels like a proper call to action. */}
        <button
          type="button"
          onClick={onStart}
          disabled={isOtherTaskRunning}
          className={`${TINT_BASE} ${TINT_INDIGO} gap-2 px-6 py-2.5 text-sm font-medium`}
          title={t('start')}
        >
          <Play className="h-4 w-4" />
          {t('start')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-3 justify-center">
      {isPaused ? (
        <button
          type="button"
          onClick={onResume}
          className={`${TINT_BASE} ${TINT_INDIGO} p-2.5`}
          aria-label={t('resumeWork')}
          title={t('resumeWork')}
        >
          <Play className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onPause}
          className={`${TINT_BASE} ${TINT_INDIGO} p-2.5`}
          aria-label={t('pause')}
          title={t('pause')}
        >
          <Pause className="h-5 w-5" />
        </button>
      )}
      <button
        type="button"
        onClick={onComplete}
        className={`${TINT_BASE} ${TINT_GREEN} p-2.5`}
        aria-label={t('complete')}
        title={t('completeTooltip')}
      >
        <Check className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onCheckpoint}
        className={`${TINT_BASE} ${TINT_ZINC} p-2.5`}
        aria-label={t('checkpointButton')}
        title={t('checkpointTooltip')}
      >
        <AlarmClockPlus className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={onStop}
        className={`${TINT_BASE} ${TINT_ZINC} p-2.5`}
        aria-label={t('cancel')}
        title={t('cancelTooltip')}
      >
        <Square className="h-5 w-5" />
      </button>
    </div>
  );
}
