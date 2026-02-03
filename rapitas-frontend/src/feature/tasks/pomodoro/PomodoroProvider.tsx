"use client";
import { ReactNode } from "react";
import {
  usePomodoroStore,
  formatTime,
  getRemainingTime,
  DEFAULT_POMODORO_DURATION,
  DEFAULT_SHORT_BREAK,
  DEFAULT_LONG_BREAK,
  PomodoroState,
  PomodoroStatus,
} from "./pomodoroStore";

export type { PomodoroStatus };

export type GlobalPomodoroState = PomodoroState;

// 後方互換性のためのProviderコンポーネント（実際には何もしない）
export function PomodoroProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

// 後方互換性のためのhook
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

// ヘルパー関数をre-export
export {
  formatTime,
  getRemainingTime,
  DEFAULT_POMODORO_DURATION,
  DEFAULT_SHORT_BREAK,
  DEFAULT_LONG_BREAK,
};
