/**
 * pomodoroUtils
 *
 * Pure utility functions for the Pomodoro feature: time formatting and remaining-time calculation.
 * No side effects — safe to import in any environment including SSR.
 */

import { DEFAULT_SETTINGS } from './pomodoroTypes';
import type { PomodoroSettings } from './pomodoroTypes';

/**
 * Formats a duration in seconds as MM:SS or H:MM:SS.
 *
 * @param seconds - Duration in seconds / 秒単位の長さ
 * @returns Formatted time string / フォーマットされた時間文字列
 */
export function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Computes the remaining time for the current work or break segment.
 *
 * @param state - Subset of PomodoroState needed for the calculation / 計算に必要なPomodoroStateのサブセット
 * @returns Remaining seconds / 残り秒数
 */
export function getRemainingTime(state: {
  isBreakTime: boolean;
  pomodoroCount: number;
  pomodoroSeconds: number;
  settings?: PomodoroSettings;
}): number {
  const settings = state.settings || DEFAULT_SETTINGS;
  if (state.isBreakTime) {
    const breakDuration =
      state.pomodoroCount % 4 === 0
        ? settings.longBreakDuration
        : settings.shortBreakDuration;
    return breakDuration - state.pomodoroSeconds;
  }
  return settings.pomodoroDuration - state.pomodoroSeconds;
}
