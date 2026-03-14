import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { API_BASE_URL } from '@/utils/api';

export type PomodoroStatus = 'idle' | 'work' | 'shortBreak' | 'longBreak';

const DEFAULT_POMODORO_DURATION = 25 * 60;
const DEFAULT_SHORT_BREAK = 5 * 60;
const DEFAULT_LONG_BREAK = 15 * 60;

export interface PomodoroSettings {
  pomodoroDuration: number; // seconds
  shortBreakDuration: number; // seconds
  longBreakDuration: number; // seconds
  soundEnabled: boolean;
  soundVolume: number; // 0-1
}

const DEFAULT_SETTINGS: PomodoroSettings = {
  pomodoroDuration: DEFAULT_POMODORO_DURATION,
  shortBreakDuration: DEFAULT_SHORT_BREAK,
  longBreakDuration: DEFAULT_LONG_BREAK,
  soundEnabled: true,
  soundVolume: 0.5,
};

let broadcastChannel: BroadcastChannel | null = null;

const getBroadcastChannel = () => {
  if (typeof window === 'undefined') return null;
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel('pomodoro-sync');
  }
  return broadcastChannel;
};

const broadcastState = (state: Partial<PomodoroState>) => {
  const channel = getBroadcastChannel();
  if (channel) {
    channel.postMessage({ type: 'STATE_UPDATE', state });
  }
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

let audioContext: AudioContext | null = null;

const getTodayDateString = () => {
  return new Date().toISOString().split('T')[0];
};

const playNotificationSound = (
  type: 'work' | 'break',
  volume: number = 0.5,
) => {
  if (typeof window === 'undefined') return;

  if (!audioContext) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioContext = new AudioContextClass();
  }

  const context = audioContext;
  if (!context) return;

  // NOTE: Browser autoplay policy suspends AudioContext until user interaction triggers resume.
  if (context.state === 'suspended') {
    context.resume();
  }

  const adjustedVolume = Math.max(0.01, Math.min(1, volume));

  if (type === 'work') {
    const playBeep = (delay: number) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.connect(gain);
      gain.connect(context.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(adjustedVolume, context.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(
        0.01,
        context.currentTime + delay + 0.15,
      );
      osc.start(context.currentTime + delay);
      osc.stop(context.currentTime + delay + 0.15);
    };
    playBeep(0);
    playBeep(0.2);
    playBeep(0.4);
  } else {
    const playBeep = (delay: number, frequency: number) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.connect(gain);
      gain.connect(context.destination);
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(adjustedVolume, context.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(
        0.01,
        context.currentTime + delay + 0.2,
      );
      osc.start(context.currentTime + delay);
      osc.stop(context.currentTime + delay + 0.2);
    };
    playBeep(0, 660);
    playBeep(0.25, 523);
  }
};

let timerIntervalId: ReturnType<typeof setInterval> | null = null;

const startTimerInterval = () => {
  if (typeof window === 'undefined') return;
  if (timerIntervalId) return;

  timerIntervalId = setInterval(() => {
    usePomodoroStore.getState().tick();
  }, 1000);
};

const stopTimerInterval = () => {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
};

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
        set({
          settings: { ...state.settings, ...newSettings },
        });
      },

      startTimer: (taskId: number, taskTitle: string) => {
        if (typeof window !== 'undefined' && !audioContext) {
          const AudioContextClass =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          audioContext = new AudioContextClass();
        }

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

        const settings = get().settings;
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
          state.pomodoroCount % 4 === 0
            ? DEFAULT_LONG_BREAK
            : DEFAULT_SHORT_BREAK;
        set({
          isBreakTime: false,
          pomodoroSeconds: 0,
          accumulatedBreakSeconds:
            state.accumulatedBreakSeconds + breakDuration,
          showBreakEndDialog: false,
        });
      },

      tick: () => {
        const state = get();

        if (!state.isTimerRunning || state.isPaused) return;
        if (state.showBreakDialog || state.showBreakEndDialog) return;

        state._checkAndResetDailyStats();

        const { settings } = state;
        const pomodoroDuration = settings.pomodoroDuration;
        const shortBreakDuration = settings.shortBreakDuration;
        const longBreakDuration = settings.longBreakDuration;

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
            state.pomodoroCount % 4 === 0
              ? longBreakDuration
              : shortBreakDuration;
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

            set({
              pomodoroSeconds: breakDuration,
              showBreakEndDialog: true,
            });
          } else {
            set({
              pomodoroSeconds: newPomodoroSeconds,
            });
          }
        }
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

export function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs
      .toString()
      .padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

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

export {
  DEFAULT_POMODORO_DURATION,
  DEFAULT_SHORT_BREAK,
  DEFAULT_LONG_BREAK,
  DEFAULT_SETTINGS,
};

const syncPomodoroToBackend = {
  start: (
    taskId: number | null,
    duration: number,
    type: 'work' | 'short_break' | 'long_break' = 'work',
  ) => {
    fetch(`${API_BASE_URL}/pomodoro/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, duration, type }),
    }).catch(() => {});
  },
  complete: (completedPomodoros: number) => {
    fetch(`${API_BASE_URL}/pomodoro/active`)
      .then((res) => res.json())
      .then((data: { session?: { id: number } }) => {
        if (data.session?.id) {
          return fetch(
            `${API_BASE_URL}/pomodoro/sessions/${data.session.id}/complete`,
            {
              method: 'POST',
            },
          );
        }
      })
      .catch(() => {});
    void completedPomodoros;
  },
  cancel: () => {
    fetch(`${API_BASE_URL}/pomodoro/active`)
      .then((res) => res.json())
      .then((data: { session?: { id: number } }) => {
        if (data.session?.id) {
          return fetch(
            `${API_BASE_URL}/pomodoro/sessions/${data.session.id}/cancel`,
            {
              method: 'POST',
            },
          );
        }
      })
      .catch(() => {});
  },
};

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
    if (broadcastChannel) {
      broadcastChannel.close();
      broadcastChannel = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
  });
}
