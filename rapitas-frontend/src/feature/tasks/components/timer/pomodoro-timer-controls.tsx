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
          variant="warning"
          size="lg"
          icon={<Pause />}
          aria-label={t('pause')}
          title={t('pause')}
        />
      )}
      <IconButton
        onClick={onCheckpoint}
        variant="secondary"
        size="lg"
        icon={<AlarmClockPlus />}
        aria-label={t('checkpointButton')}
        title={t('checkpointButton')}
      />
      <IconButton
        onClick={onComplete}
        variant="success"
        size="lg"
        icon={<CheckCircle2 />}
        aria-label={t('complete')}
        title={t('complete')}
      />
      <IconButton
        onClick={onStop}
        variant="danger"
        size="lg"
        icon={<Square />}
        aria-label={t('stop')}
        title={t('stop')}
      />
    </div>
  );
}
