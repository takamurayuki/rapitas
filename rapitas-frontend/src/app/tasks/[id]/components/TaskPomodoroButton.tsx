import React from 'react';
import { Timer, Coffee, Pause, Hourglass } from 'lucide-react';
import {
  type usePomodoro,
  formatTime,
  getRemainingTime,
} from '@/feature/tasks/pomodoro/PomodoroProvider';
import { useTranslations } from 'next-intl';

/** The pomodoro state shape as returned by usePomodoro().state */
export type PomodoroButtonState = ReturnType<typeof usePomodoro>['state'];

export interface TaskPomodoroButtonProps {
  taskTitle: string;
  isThisTaskTimer: boolean;
  pomodoroState: PomodoroButtonState;
  onClick: () => void;
}

/**
 * Get the timer button style based on pomodoro state
 */
function getTimerButtonStyle(isThisTaskTimer: boolean, pomodoroState: PomodoroButtonState): string {
  // Matches the header GlobalPomodoroWidget — bordered, text-sm/font-medium,
  // with a state-tinted background + border.
  const baseStyle =
    'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors';

  if (isThisTaskTimer && pomodoroState.isTimerRunning) {
    if (pomodoroState.isBreakTime) {
      return `${baseStyle} bg-green-50 dark:bg-green-950 border-green-300 dark:border-green-700`;
    } else if (pomodoroState.isPaused) {
      return `${baseStyle} bg-orange-50 dark:bg-orange-950 border-orange-300 dark:border-orange-700`;
    } else {
      return `${baseStyle} bg-indigo-50 dark:bg-indigo-950 border-indigo-300 dark:border-indigo-700`;
    }
  } else {
    // Idle (task-detail only; the header widget only renders while running).
    return `${baseStyle} border-zinc-200 dark:border-zinc-700`;
  }
}

/**
 * Get the timer icon based on pomodoro state
 */
function getTimerIcon(
  isThisTaskTimer: boolean,
  pomodoroState: PomodoroButtonState,
): React.ReactNode {
  if (isThisTaskTimer && pomodoroState.isTimerRunning) {
    if (pomodoroState.isBreakTime) {
      return <Coffee className="w-4 h-4 text-green-500" />;
    } else if (pomodoroState.isPaused) {
      return <Pause className="w-4 h-4 text-orange-500" />;
    } else {
      return <Hourglass className="w-4 h-4 text-indigo-500 animate-pulse" />;
    }
  } else {
    return <Timer className="w-4 h-4" />;
  }
}

/**
 * Pomodoro timer button component for task detail header.
 * Displays current timer state with appropriate icon and styling.
 */
export default function TaskPomodoroButton({
  taskTitle,
  isThisTaskTimer,
  pomodoroState,
  onClick,
}: TaskPomodoroButtonProps) {
  const t = useTranslations('pomodoro');
  return (
    <button
      onClick={onClick}
      className={getTimerButtonStyle(isThisTaskTimer, pomodoroState)}
      title={`${taskTitle} - ${t('timeManagement')}`}
    >
      {getTimerIcon(isThisTaskTimer, pomodoroState)}
      <span>{t('timeManagement')}</span>
      {isThisTaskTimer && pomodoroState.isTimerRunning && (
        <span className="text-xs font-mono tabular-nums">
          {formatTime(getRemainingTime(pomodoroState))}
        </span>
      )}
    </button>
  );
}
