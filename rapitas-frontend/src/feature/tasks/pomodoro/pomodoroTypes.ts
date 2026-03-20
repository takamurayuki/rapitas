/**
 * pomodoroTypes
 *
 * Shared type definitions and default constants for the Pomodoro feature.
 * Does not contain runtime logic — import-safe in any environment.
 */

export type PomodoroStatus = 'idle' | 'work' | 'shortBreak' | 'longBreak';

export const DEFAULT_POMODORO_DURATION = 25 * 60;
export const DEFAULT_SHORT_BREAK = 5 * 60;
export const DEFAULT_LONG_BREAK = 15 * 60;

export interface PomodoroSettings {
  pomodoroDuration: number; // seconds
  shortBreakDuration: number; // seconds
  longBreakDuration: number; // seconds
  soundEnabled: boolean;
  soundVolume: number; // 0-1
}

export const DEFAULT_SETTINGS: PomodoroSettings = {
  pomodoroDuration: DEFAULT_POMODORO_DURATION,
  shortBreakDuration: DEFAULT_SHORT_BREAK,
  longBreakDuration: DEFAULT_LONG_BREAK,
  soundEnabled: true,
  soundVolume: 0.5,
};

export interface PomodoroState {
  taskId: number | null;
  taskTitle: string | null;

  isTimerRunning: boolean;
  isPaused: boolean;
  isBreakTime: boolean;

  pomodoroCount: number;
  pomodoroSeconds: number;

  workSeconds: number;
  accumulatedBreakSeconds: number;
  timerStartTime: number | null; // Unix timestamp

  showBreakDialog: boolean;
  showBreakEndDialog: boolean;

  settings: PomodoroSettings;

  todayCompletedPomodoros: number;
  todayTotalWorkSeconds: number;
  lastStatDate: string | null; // YYYY-MM-DD

  _hasHydrated: boolean;

  startTimer: (taskId: number, taskTitle: string) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  stopTimer: () => void;
  takeBreak: () => void;
  skipBreak: () => void;
  endBreak: () => void;
  tick: () => void;
  updateSettings: (settings: Partial<PomodoroSettings>) => void;
  _initializeTimer: () => void;
  _setHasHydrated: (value: boolean) => void;
  _checkAndResetDailyStats: () => void;
}
