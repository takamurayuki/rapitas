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
  // No outline/shadow — flat by default; active states keep a tinted background
  // as the only timer indicator.
  const baseStyle =
    'flex items-center gap-2 px-3 py-2 text-xs font-black font-mono tracking-tight rounded-lg transition-colors text-zinc-700 dark:text-zinc-300';

  if (isThisTaskTimer && pomodoroState.isTimerRunning) {
    if (pomodoroState.isBreakTime) {
      return `${baseStyle} bg-green-50 dark:bg-green-950 hover:bg-green-100 dark:hover:bg-green-900`;
    } else if (pomodoroState.isPaused) {
      return `${baseStyle} bg-orange-50 dark:bg-orange-950 hover:bg-orange-100 dark:hover:bg-orange-900`;
    } else {
      return `${baseStyle} bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 dark:hover:bg-blue-900`;
    }
  } else {
    return `${baseStyle} text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800`;
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
      return <Coffee className="w-4 h-4" />;
    } else if (pomodoroState.isPaused) {
      return <Pause className="w-4 h-4" />;
    } else {
      return <Hourglass className="w-4 h-4 animate-pulse" />;
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
