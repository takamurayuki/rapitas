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
          variant="primary"
          size="lg"
          icon={<Play />}
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
          variant="primary"
          size="lg"
          icon={<Play />}
          aria-label={t('resumeWork')}
          title={t('resumeWork')}
        />
      ) : (
        <IconButton
          onClick={onPause}
          variant="primary"
          size="lg"
          icon={<Pause />}
          aria-label={t('pause')}
          title={t('pause')}
        />
      )}
      {/* Semantic green lives on the ICON only — the row keeps a single
          accent fill (start/pause) per the ui-design-language "one accent"
          rule; a second filled hue reads as the candy-button tell. */}
      <IconButton
        onClick={onComplete}
        variant="secondary"
        size="lg"
        icon={<CheckCircle2 className="text-green-600 dark:text-green-400" />}
        aria-label={t('complete')}
        title={t('completeTooltip')}
      />
      {/* Checkpoint is the one non-universal glyph in the row — it keeps a
          small text label (operator-approved design); the rest are icon-only. */}
      <button
        type="button"
        onClick={onCheckpoint}
        aria-label={t('checkpointButton')}
        title={t('checkpointTooltip')}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <AlarmClockPlus className="h-4 w-4" />
        {t('checkpointButton')}
      </button>
      {/* Cancel discards time, so it is the QUIETEST control (ghost, smaller)
          — visual priority: start/pause > complete > checkpoint > cancel. */}
      <IconButton
        onClick={onStop}
        variant="ghost"
        size="md"
        icon={<Square />}
        aria-label={t('cancel')}
        title={t('cancelTooltip')}
      />
    </div>
  );
}
