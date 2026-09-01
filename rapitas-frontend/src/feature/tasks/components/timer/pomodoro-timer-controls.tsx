/**
 * pomodoroTimerControls
 *
 * Icon-only control row for the Pomodoro timer (start / pause / resume /
 * checkpoint / complete / stop). Extracted from PomodoroTimer.tsx to keep
 * that file under the project's file-size limit.
 */
'use client';
import { Play, Pause, Square, Check, AlarmClockPlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import IconButton from '@/components/ui/button/IconButton';

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
}

// Filled circular action (start/pause/complete): solid disc, STROKED white
// glyph — the icon interior stays unfilled (operator-approved inverted style).
// Matches IconButton lg metrics (p-2.5 disc, h-5 w-5 glyph).
const FILLED_BASE =
  'flex items-center justify-center rounded-full p-2.5 text-white transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ' +
  'disabled:cursor-not-allowed disabled:opacity-50';
const FILLED_INDIGO =
  'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600';
// Green (not emerald) per ui-design-language: success/completed = green.
const FILLED_GREEN = 'bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500';

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
}: PomodoroTimerControlsProps) {
  const t = useTranslations('pomodoro');

  if (isBreakTime) return null;

  if (!isTimerRunning) {
    return (
      <div className="flex gap-3 justify-center">
        <button
          type="button"
          onClick={onStart}
          disabled={isOtherTaskRunning}
          className={`${FILLED_BASE} ${FILLED_INDIGO}`}
          aria-label={t('start')}
          title={t('start')}
        >
          <Play className="h-5 w-5" />
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
          className={`${FILLED_BASE} ${FILLED_INDIGO}`}
          aria-label={t('resumeWork')}
          title={t('resumeWork')}
        >
          <Play className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onPause}
          className={`${FILLED_BASE} ${FILLED_INDIGO}`}
          aria-label={t('pause')}
          title={t('pause')}
        >
          <Pause className="h-5 w-5" />
        </button>
      )}
      {/* Zero-fill transport cluster (operator-approved): no button carries a
          background. Priority reads from the primary's ring + accent glyph,
          then icon tints, then plain ghosts — fills read as unrefined here. */}
      <button
        type="button"
        onClick={onComplete}
        className={`${FILLED_BASE} ${FILLED_GREEN}`}
        aria-label={t('complete')}
        title={t('completeTooltip')}
      >
        <Check className="h-5 w-5" />
      </button>
      {/* Uniform ring row (operator feedback: mixed treatments read as
          disjointed). Checkpoint is icon-only like the rest — its behavior
          lives in the tooltip. */}
      <IconButton
        onClick={onCheckpoint}
        variant="ghost"
        size="lg"
        className="rounded-full border border-zinc-300 dark:border-zinc-600"
        icon={<AlarmClockPlus />}
        aria-label={t('checkpointButton')}
        title={t('checkpointTooltip')}
      />
      {/* Cancel discards time, so it is the QUIETEST control (ghost, smaller)
          — visual priority: start/pause > complete > checkpoint > cancel. */}
      <IconButton
        onClick={onStop}
        variant="ghost"
        size="lg"
        className="rounded-full border border-zinc-300 dark:border-zinc-600"
        icon={<Square />}
        aria-label={t('cancel')}
        title={t('cancelTooltip')}
      />
    </div>
  );
}
