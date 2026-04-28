/**
 * pomodoroStore
 *
 * Zustand store for the Pomodoro timer feature.
 * Manages timer state, daily statistics, and orchestrates audio/sync/broadcast side-effects.
 * Persisted to localStorage so the timer survives page refreshes.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getAudioContext, closeAudioContext } from './pomodoro-audio';
import { syncPomodoroToBackend } from './pomodoro-sync';
import { handleTick } from './pomodoro-tick';
import { broadcastState, getBroadcastChannel, closeBroadcastChannel } from './pomodoro-broadcast';
import { DEFAULT_SHORT_BREAK, DEFAULT_LONG_BREAK, DEFAULT_SETTINGS } from './pomodoro-types';
import type { PomodoroState, PomodoroSettings } from './pomodoro-types'; // HACK(agent): PomodoroSettings kept for updateSettings action signature

// --- Re-exports for backward compatibility ---
export type { PomodoroStatus, PomodoroSettings, PomodoroState } from './pomodoro-types';
export {
  DEFAULT_POMODORO_DURATION,
  DEFAULT_SHORT_BREAK,
  DEFAULT_LONG_BREAK,
  DEFAULT_SETTINGS,
} from './pomodoro-types';
export { formatTime, getRemainingTime } from './pomodoro-utils';

// --- Timer interval singleton ---

let timerIntervalId: ReturnType<typeof setInterval> | null = null;

const startTimerInterval = (): void => {
  if (typeof window === 'undefined') return;
  if (timerIntervalId) return;

  timerIntervalId = setInterval(() => {
    usePomodoroStore.getState().tick();
  }, 1000);
};

const stopTimerInterval = (): void => {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
};

// --- Utility helpers ---

const getTodayDateString = (): string => new Date().toISOString().split('T')[0];

// --- Store ---

export const usePomodoroStore = create<PomodoroState>()(
  persist(
    (set, get) => ({
      taskId: null,
      taskTitle: null,
      isTimerRunning: false,
      isPaused: false,
      isBreakTime: false,
      pomodoroCount: 0,
      pomodoroSeconds: 0,
      workSeconds: 0,
      accumulatedBreakSeconds: 0,
      timerStartTime: null,
      showBreakDialog: false,
      showBreakEndDialog: false,
      settings: DEFAULT_SETTINGS,
      todayCompletedPomodoros: 0,
      todayTotalWorkSeconds: 0,
      lastStatDate: null,
      _hasHydrated: false,

      _setHasHydrated: (value: boolean) => {
        set({ _hasHydrated: value });
      },

      _checkAndResetDailyStats: () => {
        const state = get();
        const today = getTodayDateString();
        if (state.lastStatDate !== today) {
          set({
            todayCompletedPomodoros: 0,
            todayTotalWorkSeconds: 0,
            lastStatDate: today,
          });
        }
      },

      updateSettings: (newSettings: Partial<PomodoroSettings>) => {
        const state = get();
        set({ settings: { ...state.settings, ...newSettings } });
      },

      startTimer: (taskId: number, taskTitle: string) => {
        // Eagerly warm up AudioContext to satisfy browser autoplay policy on first user gesture.
        getAudioContext();

        const newState = {
          taskId,
          taskTitle,
          isTimerRunning: true,
          isPaused: false,
          isBreakTime: false,
          pomodoroCount: 0,
          pomodoroSeconds: 0,
          workSeconds: 0,
          accumulatedBreakSeconds: 0,
          timerStartTime: Date.now(),
          showBreakDialog: false,
          showBreakEndDialog: false,
        };

        set(newState);
        broadcastState(newState);
        startTimerInterval();

        const { settings } = get();
        syncPomodoroToBackend.start(taskId, settings.pomodoroDuration, 'work');
      },

      pauseTimer: () => {
        set({ isPaused: true });
        broadcastState({ isPaused: true });
      },

      resumeTimer: () => {
        set({ isPaused: false });
        broadcastState({ isPaused: false });
      },

      stopTimer: () => {
        stopTimerInterval();
        syncPomodoroToBackend.cancel();

        const newState = {
          taskId: null,
          taskTitle: null,
          isTimerRunning: false,
          isPaused: false,
          isBreakTime: false,
          pomodoroCount: 0,
          pomodoroSeconds: 0,
          workSeconds: 0,
          accumulatedBreakSeconds: 0,
          timerStartTime: null,
          showBreakDialog: false,
          showBreakEndDialog: false,
        };
        set(newState);
        broadcastState(newState);
      },

      takeBreak: () => {
        const state = get();
        const newCount = state.pomodoroCount + 1;
        const isLongBreak = newCount % 4 === 0;
        const breakType = isLongBreak ? 'long_break' : 'short_break';
        const breakDuration = isLongBreak
          ? state.settings.longBreakDuration
          : state.settings.shortBreakDuration;

        set({
          pomodoroCount: newCount,
          isBreakTime: true,
          pomodoroSeconds: 0,
          showBreakDialog: false,
        });

        syncPomodoroToBackend.start(state.taskId, breakDuration, breakType);
      },

      skipBreak: () => {
        const state = get();
        set({
          pomodoroCount: state.pomodoroCount + 1,
          pomodoroSeconds: 0,
          showBreakDialog: false,
        });
      },

      endBreak: () => {
        const state = get();
        const breakDuration =
          state.pomodoroCount % 4 === 0 ? DEFAULT_LONG_BREAK : DEFAULT_SHORT_BREAK;
        set({
          isBreakTime: false,
          pomodoroSeconds: 0,
          accumulatedBreakSeconds: state.accumulatedBreakSeconds + breakDuration,
          showBreakEndDialog: false,
        });
      },

      tick: () => {
        handleTick(set, get);
      },

      _initializeTimer: () => {
        const state = get();
        if (state.isTimerRunning && !state.isPaused && !timerIntervalId) {
          startTimerInterval();
        }
      },
    }),
    {
      name: 'pomodoro-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
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
        settings: state.settings,
        todayCompletedPomodoros: state.todayCompletedPomodoros,
        todayTotalWorkSeconds: state.todayTotalWorkSeconds,
        lastStatDate: state.lastStatDate,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state._setHasHydrated(true);
          state._checkAndResetDailyStats();
          state._initializeTimer();
        }
      },
    },
  ),
);

// NOTE: formatTime and getRemainingTime are re-exported from pomodoroUtils.ts above.

// --- Cross-tab sync setup ---

if (typeof window !== 'undefined') {
  const channel = getBroadcastChannel();
  if (channel) {
    channel.onmessage = (event) => {
      if (event.data?.type === 'STATE_UPDATE' && event.data?.state) {
        const currentState = usePomodoroStore.getState();
        const newState = event.data.state;

        usePomodoroStore.setState({
          ...newState,
          _hasHydrated: currentState._hasHydrated,
        });

        if (newState.isTimerRunning && !timerIntervalId) {
          startTimerInterval();
        } else if (!newState.isTimerRunning && timerIntervalId) {
          stopTimerInterval();
        }
      }
    };
  }

  window.addEventListener('beforeunload', () => {
    stopTimerInterval();
    closeBroadcastChannel();
    closeAudioContext();
  });
}
