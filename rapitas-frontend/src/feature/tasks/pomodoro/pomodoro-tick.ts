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
import { useLocaleStore } from '@/stores/locale-store';
import ja from '../../../../messages/ja.json';
import en from '../../../../messages/en.json';

type SetFn = (partial: Partial<PomodoroState>) => void;
type GetFn = () => PomodoroState;

const messages = { ja, en } as const;

/**
 * Resolves a dot-path key under the `task` namespace from the current
 * locale's static message bundle. This module runs outside React (invoked
 * from a Zustand store's setInterval tick), so next-intl's useTranslations
 * hook isn't available — this reads the same JSON the hook would use.
 *
 * @param key - Dot-path key into the `task` namespace / `task`名前空間内のドット区切りキー
 * @returns Resolved string, or the key itself if missing / 解決済み文字列（未解決時はキーそのもの）
 */
function tPomodoro(key: string): string {
  const locale = useLocaleStore.getState().locale;
  const bundle: unknown = messages[locale]?.task;
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      bundle,
    );
  return typeof value === 'string' ? value : key;
}

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
        const taskLabel = state.taskTitle || tPomodoro('pomodoroNotification.taskFallback');
        new Notification(tPomodoro('pomodoroNotification.workCompleteTitle'), {
          body: tPomodoro('pomodoroNotification.workCompleteBody').replace('{task}', taskLabel),
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
    const breakDuration = state.pomodoroCount % 4 === 0 ? longBreakDuration : shortBreakDuration;
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
        new Notification(tPomodoro('pomodoroNotification.breakEndTitle'), {
          body: tPomodoro('pomodoroNotification.breakEndBody'),
          icon: '/favicon.ico',
        });
      }

      set({ pomodoroSeconds: breakDuration, showBreakEndDialog: true });
    } else {
      set({ pomodoroSeconds: newPomodoroSeconds });
    }
  }
};
