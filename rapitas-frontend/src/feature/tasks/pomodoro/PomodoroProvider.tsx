'use client';
import { type ReactNode } from 'react';
import {
  usePomodoroStore,
  formatTime,
  getRemainingTime,
  DEFAULT_POMODORO_DURATION,
  DEFAULT_SHORT_BREAK,
  DEFAULT_LONG_BREAK,
  type PomodoroState,
  type PomodoroStatus,
} from './pomodoro-store';

export type { PomodoroStatus };

export type GlobalPomodoroState = PomodoroState;

// Provider component for backward compatibility (doesn't actually do anything)
export function PomodoroProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// Hook for backward compatibility
export function usePomodoro() {
  const state = usePomodoroStore();

  return {
    state: {
      taskId: state.taskId,
      taskTitle: state.taskTitle,
      isTimerRunning: state.isTimerRunning,
      isPaused: state.isPaused,
      isBreakTime: state.isBreakTime,
      pomodoroCount: state.pomodoroCount,
      pomodoroSeconds: state.pomodoroSeconds,
      workSeconds: state.workSeconds,
      accumulatedBreakSeconds: state.accumulatedBreakSeconds,
      timerStartTime: state.timerStartTime,
      showBreakDialog: state.showBreakDialog,
      showBreakEndDialog: state.showBreakEndDialog,
    },
    startTimer: state.startTimer,
    pauseTimer: state.pauseTimer,
    resumeTimer: state.resumeTimer,
    stopTimer: state.stopTimer,
    takeBreak: state.takeBreak,
    skipBreak: state.skipBreak,
    endBreak: state.endBreak,
  };
}

// Re-export helper functions
export {
  formatTime,
  getRemainingTime,
  DEFAULT_POMODORO_DURATION,
  DEFAULT_SHORT_BREAK,
  DEFAULT_LONG_BREAK,
};
