/**
 * pomodoroTick
 *
 * Pure tick-handler logic for the Pomodoro store.
 * Extracted to keep pomodoroStore.ts under the 300-line file size limit.
 * Takes a Zustand set/get pair and executes one timer second.
 */

import { playNotificationSound } from './pomodoro-audio';
import { syncPomodoroToBackend } from './pomodoro-sync';
import type { PomodoroState } from './pomodoro-types';

type SetFn = (partial: Partial<PomodoroState>) => void;
type GetFn = () => PomodoroState;

/**
 * Advances the Pomodoro timer by one second.
 * Handles work completion (shows break dialog, triggers audio/notification/sync)
 * and break completion (shows break-end dialog, triggers audio/notification).
 *
 * @param set - Zustand set function / Zustandのset関数
 * @param get - Zustand get function / Zustandのget関数
 */
export const handleTick = (set: SetFn, get: GetFn): void => {
  const state = get();

  if (!state.isTimerRunning || state.isPaused) return;
  if (state.showBreakDialog || state.showBreakEndDialog) return;

  state._checkAndResetDailyStats();

  const { settings } = state;
  const { pomodoroDuration, shortBreakDuration, longBreakDuration } = settings;

  if (!state.isBreakTime) {
    const newPomodoroSeconds = state.pomodoroSeconds + 1;
    const newWorkSeconds = state.workSeconds + 1;
    const newTodayWorkSeconds = state.todayTotalWorkSeconds + 1;

    if (newPomodoroSeconds >= pomodoroDuration) {
      if (settings.soundEnabled) {
        playNotificationSound('work', settings.soundVolume);
      }

      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        new Notification('ポモドーロ完了！', {
          body: `${state.taskTitle || 'タスク'} — 休憩を取りましょう`,
          icon: '/favicon.ico',
        });
      }

      syncPomodoroToBackend.complete(state.pomodoroCount + 1);

      set({
        pomodoroSeconds: pomodoroDuration,
        workSeconds: newWorkSeconds,
        todayTotalWorkSeconds: newTodayWorkSeconds,
        todayCompletedPomodoros: state.todayCompletedPomodoros + 1,
        showBreakDialog: true,
      });
    } else {
      set({
        pomodoroSeconds: newPomodoroSeconds,
        workSeconds: newWorkSeconds,
        todayTotalWorkSeconds: newTodayWorkSeconds,
      });
    }
  } else {
    const breakDuration =
      state.pomodoroCount % 4 === 0 ? longBreakDuration : shortBreakDuration;
    const newPomodoroSeconds = state.pomodoroSeconds + 1;

    if (newPomodoroSeconds >= breakDuration) {
      if (settings.soundEnabled) {
        playNotificationSound('break', settings.soundVolume);
      }

      if (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        new Notification('休憩終了！', {
          body: '作業を再開しましょう',
          icon: '/favicon.ico',
        });
      }

      set({ pomodoroSeconds: breakDuration, showBreakEndDialog: true });
    } else {
      set({ pomodoroSeconds: newPomodoroSeconds });
    }
  }
};
