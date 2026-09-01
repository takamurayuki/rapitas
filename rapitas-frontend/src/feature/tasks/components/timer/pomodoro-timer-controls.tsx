/**
 * pomodoroTimerControls
 *
 * Icon-only control row for the Pomodoro timer (start / pause / resume /
 * checkpoint / complete / stop). Extracted from PomodoroTimer.tsx to keep
 * that file under the project's file-size limit.
 */
'use client';
import { Play, Pause, Square, CheckCircle2, AlarmClockPlus } from 'lucide-react';
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
        <IconButton
          onClick={onStart}
          disabled={isOtherTaskRunning}
          variant="ghost"
          size="lg"
          className="rounded-full border border-zinc-300 dark:border-zinc-600"
          icon={<Play className="text-indigo-600 dark:text-indigo-400" />}
          aria-label={t('start')}
          title={t('start')}
        />
      </div>
    );
  }

  return (
    <div className="flex gap-3 justify-center">
      {isPaused ? (
        <IconButton
          onClick={onResume}
          variant="ghost"
          size="lg"
          className="rounded-full border border-zinc-300 dark:border-zinc-600"
          icon={<Play className="text-indigo-600 dark:text-indigo-400" />}
          aria-label={t('resumeWork')}
          title={t('resumeWork')}
        />
      ) : (
        <IconButton
          onClick={onPause}
          variant="ghost"
          size="lg"
          className="rounded-full border border-zinc-300 dark:border-zinc-600"
          icon={<Pause className="text-indigo-600 dark:text-indigo-400" />}
          aria-label={t('pause')}
          title={t('pause')}
        />
      )}
      {/* Zero-fill transport cluster (operator-approved): no button carries a
          background. Priority reads from the primary's ring + accent glyph,
          then icon tints, then plain ghosts — fills read as unrefined here. */}
      <IconButton
        onClick={onComplete}
        variant="ghost"
        size="lg"
        className="rounded-full border border-zinc-300 dark:border-zinc-600"
        icon={<CheckCircle2 className="text-green-600 dark:text-green-400" />}
        aria-label={t('complete')}
        title={t('completeTooltip')}
      />
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
