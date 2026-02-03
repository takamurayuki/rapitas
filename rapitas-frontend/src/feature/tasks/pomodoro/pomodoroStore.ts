import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type PomodoroStatus = "idle" | "work" | "shortBreak" | "longBreak";

// デフォルト値
const DEFAULT_POMODORO_DURATION = 25 * 60; // 25分
const DEFAULT_SHORT_BREAK = 5 * 60; // 5分
const DEFAULT_LONG_BREAK = 15 * 60; // 15分

// カスタマイズ可能な設定
export interface PomodoroSettings {
  pomodoroDuration: number; // 秒
  shortBreakDuration: number; // 秒
  longBreakDuration: number; // 秒
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

// BroadcastChannel for syncing state between iframe and parent
let broadcastChannel: BroadcastChannel | null = null;

const getBroadcastChannel = () => {
  if (typeof window === "undefined") return null;
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel("pomodoro-sync");
  }
  return broadcastChannel;
};

// 状態を他のコンテキストに通知
const broadcastState = (state: Partial<PomodoroState>) => {
  const channel = getBroadcastChannel();
  if (channel) {
    channel.postMessage({ type: "STATE_UPDATE", state });
  }
};

export interface PomodoroState {
  // タスク情報
  taskId: number | null;
  taskTitle: string | null;

  // タイマー状態
  isTimerRunning: boolean;
  isPaused: boolean;
  isBreakTime: boolean;

  // ポモドーロカウント
  pomodoroCount: number;
  pomodoroSeconds: number;

  // 作業時間トラッキング
  workSeconds: number;
  accumulatedBreakSeconds: number;
  timerStartTime: number | null; // Unix timestamp

  // ダイアログ状態
  showBreakDialog: boolean;
  showBreakEndDialog: boolean;

  // 設定
  settings: PomodoroSettings;

  // 統計（今日の累計）
  todayCompletedPomodoros: number;
  todayTotalWorkSeconds: number;
  lastStatDate: string | null; // YYYY-MM-DD

  // Hydration状態
  _hasHydrated: boolean;

  // アクション
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

// AudioContext用のグローバル変数
let audioContext: AudioContext | null = null;

// 今日の日付を取得
const getTodayDateString = () => {
  return new Date().toISOString().split("T")[0];
};

// 通知音を再生
const playNotificationSound = (
  type: "work" | "break",
  volume: number = 0.5,
) => {
  if (typeof window === "undefined") return;

  if (!audioContext) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioContext = new AudioContextClass();
  }

  const context = audioContext;
  if (!context) return;

  // AudioContext が suspended の場合は resume
  if (context.state === "suspended") {
    context.resume();
  }

  const adjustedVolume = Math.max(0.01, Math.min(1, volume));

  if (type === "work") {
    // 作業終了: 高い音3回
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
    // 休憩終了: 低い音2回
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

// タイマーのインターバルID
let timerIntervalId: ReturnType<typeof setInterval> | null = null;

// タイマーを開始
const startTimerInterval = () => {
  if (typeof window === "undefined") return;
  if (timerIntervalId) return;

  timerIntervalId = setInterval(() => {
    usePomodoroStore.getState().tick();
  }, 1000);
};

// タイマーを停止
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
        // AudioContextを初期化
        if (typeof window !== "undefined" && !audioContext) {
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
        set({
          pomodoroCount: state.pomodoroCount + 1,
          isBreakTime: true,
          pomodoroSeconds: 0,
          showBreakDialog: false,
        });
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

        // 日付が変わったら統計をリセット
        state._checkAndResetDailyStats();

        const { settings } = state;
        const pomodoroDuration = settings.pomodoroDuration;
        const shortBreakDuration = settings.shortBreakDuration;
        const longBreakDuration = settings.longBreakDuration;

        if (!state.isBreakTime) {
          // 作業中
          const newPomodoroSeconds = state.pomodoroSeconds + 1;
          const newWorkSeconds = state.workSeconds + 1;
          const newTodayWorkSeconds = state.todayTotalWorkSeconds + 1;

          if (newPomodoroSeconds >= pomodoroDuration) {
            // ポモドーロ完了
            if (settings.soundEnabled) {
              playNotificationSound("work", settings.soundVolume);
            }
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
          // 休憩中
          const breakDuration =
            state.pomodoroCount % 4 === 0
              ? longBreakDuration
              : shortBreakDuration;
          const newPomodoroSeconds = state.pomodoroSeconds + 1;

          if (newPomodoroSeconds >= breakDuration) {
            if (settings.soundEnabled) {
              playNotificationSound("break", settings.soundVolume);
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

      // ページロード時にタイマーを再開する
      _initializeTimer: () => {
        const state = get();
        if (state.isTimerRunning && !state.isPaused && !timerIntervalId) {
          startTimerInterval();
        }
      },
    }),
    {
      name: "pomodoro-storage",
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
          state._initializeTimer();
        }
      },
    },
  ),
);

// ヘルパー関数
export function formatTime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
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

// BroadcastChannelのリスナーを設定（クライアントサイドのみ）
if (typeof window !== "undefined") {
  const channel = getBroadcastChannel();
  if (channel) {
    channel.onmessage = (event) => {
      if (event.data?.type === "STATE_UPDATE" && event.data?.state) {
        const currentState = usePomodoroStore.getState();
        const newState = event.data.state;

        // 状態を更新
        usePomodoroStore.setState({
          ...newState,
          _hasHydrated: currentState._hasHydrated,
        });

        // タイマーの開始/停止を同期
        if (newState.isTimerRunning && !timerIntervalId) {
          startTimerInterval();
        } else if (!newState.isTimerRunning && timerIntervalId) {
          stopTimerInterval();
        }
      }
    };
  }
}
