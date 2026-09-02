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

// NOTE: pinned to globalThis, NOT module scope — Next dev HMR re-evaluates
// this module and a module-scope id resets to null while the OLD interval
// keeps ticking. Every hot update then leaked one more 1s tick per window;
// dozens of stale ticks firing boundary syncs/broadcasts were the root cause
// of the recurring WebView2 CPU spikes (2026-09-03). Same reason the current
// store hook is re-published below: leaked timers must tick the LIVE store.
const g = globalThis as unknown as {
  __rapitasPomodoroTick?: ReturnType<typeof setInterval> | null;
  __rapitasPomodoroStore?: () => { tick: () => void };
  __rapitasPomodoroWired?: boolean;
};

const startTimerInterval = (): void => {
  if (typeof window === 'undefined') return;
  if (g.__rapitasPomodoroTick) return;

  g.__rapitasPomodoroTick = setInterval(() => {
    (g.__rapitasPomodoroStore ?? usePomodoroStore.getState)().tick();
  }, 1000);
};

const stopTimerInterval = (): void => {
  if (g.__rapitasPomodoroTick) {
    clearInterval(g.__rapitasPomodoroTick);
    g.__rapitasPomodoroTick = null;
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
      lastUsedTaskId: null,
      lastUsedTaskTitle: null,
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

      setLastUsedTask: (taskId: number, taskTitle: string) => {
        // Task handover from the task detail page to the (separate-webview)
        // float window: broadcast so the float's idle screen re-renders with
        // the task without needing a rehydrate.
        const newState = { lastUsedTaskId: taskId, lastUsedTaskTitle: taskTitle };
        set(newState);
        broadcastState(newState);
      },

      startTimer: (taskId: number | null, taskTitle: string | null) => {
        // Eagerly warm up AudioContext to satisfy browser autoplay policy on first user gesture.
        getAudioContext();

        const newState = {
          taskId,
          taskTitle,
          lastUsedTaskId: taskId,
          lastUsedTaskTitle: taskTitle,
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

      cutBreakShort: () => {
        // Early break exit (operator request 2026-09-03): unlike endBreak,
        // only the ELAPSED break time is added — crediting the full duration
        // for a break the user cut short would inflate the break stats.
        const state = get();
        const newState = {
          isBreakTime: false,
          pomodoroSeconds: 0,
          accumulatedBreakSeconds: state.accumulatedBreakSeconds + state.pomodoroSeconds,
          showBreakEndDialog: false,
        };
        set(newState);
        broadcastState(newState);
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
        if (state.isTimerRunning && !state.isPaused && !g.__rapitasPomodoroTick) {
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
        lastUsedTaskId: state.lastUsedTaskId,
        lastUsedTaskTitle: state.lastUsedTaskTitle,
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

// Wire cross-window sync exactly once per window (globalThis guard): under
// dev HMR this module re-evaluates, and re-wiring would stack duplicate
// channel handlers and Tauri listeners (see the tick singleton note above).
if (typeof window !== 'undefined') {
  g.__rapitasPomodoroStore = usePomodoroStore.getState;
}
if (typeof window !== 'undefined' && !g.__rapitasPomodoroWired) {
  g.__rapitasPomodoroWired = true;
  const channel = getBroadcastChannel();
  if (channel) {
    // NOTE: this handler is wired ONCE (first evaluation) but must always
    // update the CURRENT store instance — hence the setState/getState pair is
    // captured from the module that wired it; under HMR zustand keeps the
    // same store object alive across re-evals for an unchanged create() call,
    // and a full reload rewires from scratch.
    channel.onmessage = (event) => {
      if (event.data?.type === 'STATE_UPDATE' && event.data?.state) {
        const currentState = usePomodoroStore.getState();
        const newState = event.data.state;

        usePomodoroStore.setState({
          ...newState,
          _hasHydrated: currentState._hasHydrated,
        });

        if (newState.isTimerRunning && !g.__rapitasPomodoroTick) {
          startTimerInterval();
        } else if (!newState.isTimerRunning && g.__rapitasPomodoroTick) {
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

  // The pomodoro-float window delegates Checkpoint and Cancel here (via Tauri
  // events) instead of calling syncPomodoroToBackend itself, because
  // /pomodoro-float is excluded from isSyncOwner. Registered at module level
  // (not inside a component) so it keeps working for the lifetime of the main
  // window regardless of what is currently rendered.
  if ('__TAURI_INTERNALS__' in window) {
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('pomodoro-float:checkpoint-request', () => {
        void syncPomodoroToBackend.checkpoint();
      });
      listen('pomodoro-float:cancel-request', () => {
        void syncPomodoroToBackend.cancel();
      });
    });
  }
}
