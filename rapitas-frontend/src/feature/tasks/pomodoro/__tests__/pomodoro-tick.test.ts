/**
 * pomodoro-tick tests
 *
 * handleTick is a plain function taking Zustand-shaped set/get callbacks, so
 * it's exercised directly with a hand-rolled state container rather than the
 * real store. Audio and backend-sync side effects are mocked; the
 * Notification API (absent in jsdom) is mocked per-test where needed.
 */
vi.mock('../pomodoro-audio', () => ({
  playNotificationSound: vi.fn(),
}));

vi.mock('../pomodoro-sync', () => ({
  syncPomodoroToBackend: {
    start: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
  },
}));

import { handleTick } from '../pomodoro-tick';
import { playNotificationSound } from '../pomodoro-audio';
import { syncPomodoroToBackend } from '../pomodoro-sync';
import { useLocaleStore } from '@/stores/locale-store';
import { DEFAULT_SETTINGS } from '../pomodoro-types';
import type { PomodoroState } from '../pomodoro-types';

type State = PomodoroState;

function createState(overrides: Partial<State> = {}): State {
  return {
    taskId: 1,
    taskTitle: 'Write tests',
    lastUsedTaskId: 1,
    lastUsedTaskTitle: 'Write tests',
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
    settings: DEFAULT_SETTINGS,
    todayCompletedPomodoros: 0,
    todayTotalWorkSeconds: 0,
    lastStatDate: null,
    _hasHydrated: true,
    setLastUsedTask: vi.fn(),
    startTimer: vi.fn(),
    pauseTimer: vi.fn(),
    resumeTimer: vi.fn(),
    stopTimer: vi.fn(),
    takeBreak: vi.fn(),
    skipBreak: vi.fn(),
    endBreak: vi.fn(),
    tick: vi.fn(),
    updateSettings: vi.fn(),
    _initializeTimer: vi.fn(),
    _setHasHydrated: vi.fn(),
    _checkAndResetDailyStats: vi.fn(),
    ...overrides,
  };
}

describe('handleTick', () => {
  let state: State;
  const set = (partial: Partial<State>) => {
    state = { ...state, ...partial };
  };
  const get = () => state;

  beforeEach(() => {
    vi.clearAllMocks();
    useLocaleStore.setState({ locale: 'en' });
    delete (window as unknown as { Notification?: unknown }).Notification;
  });

  it('is a no-op when the timer is not running', () => {
    state = createState({ isTimerRunning: false });
    handleTick(set, get);
    expect(state._checkAndResetDailyStats).not.toHaveBeenCalled();
  });

  it('is a no-op when paused', () => {
    state = createState({ isPaused: true });
    handleTick(set, get);
    expect(state._checkAndResetDailyStats).not.toHaveBeenCalled();
  });

  it('is a no-op while the break dialog is showing', () => {
    state = createState({ showBreakDialog: true });
    handleTick(set, get);
    expect(state._checkAndResetDailyStats).not.toHaveBeenCalled();
  });

  it('is a no-op while the break-end dialog is showing', () => {
    state = createState({ showBreakEndDialog: true });
    handleTick(set, get);
    expect(state._checkAndResetDailyStats).not.toHaveBeenCalled();
  });

  it('always checks/resets daily stats when actually ticking', () => {
    state = createState();
    handleTick(set, get);
    expect(state._checkAndResetDailyStats).toHaveBeenCalledTimes(1);
  });

  describe('work segment', () => {
    it('increments seconds counters without completing the segment', () => {
      state = createState({ pomodoroSeconds: 5, workSeconds: 5, todayTotalWorkSeconds: 5 });
      handleTick(set, get);
      expect(state.pomodoroSeconds).toBe(6);
      expect(state.workSeconds).toBe(6);
      expect(state.todayTotalWorkSeconds).toBe(6);
      expect(state.showBreakDialog).toBe(false);
      expect(playNotificationSound).not.toHaveBeenCalled();
      expect(syncPomodoroToBackend.complete).not.toHaveBeenCalled();
    });

    it('completes the work segment once duration is reached', () => {
      state = createState({
        pomodoroSeconds: DEFAULT_SETTINGS.pomodoroDuration - 1,
        pomodoroCount: 2,
      });
      handleTick(set, get);

      expect(state.pomodoroSeconds).toBe(DEFAULT_SETTINGS.pomodoroDuration);
      expect(state.showBreakDialog).toBe(true);
      expect(state.todayCompletedPomodoros).toBe(1);
      expect(syncPomodoroToBackend.complete).toHaveBeenCalledWith(3);
    });

    it('plays the work notification sound when sound is enabled', () => {
      state = createState({
        pomodoroSeconds: DEFAULT_SETTINGS.pomodoroDuration - 1,
        settings: { ...DEFAULT_SETTINGS, soundEnabled: true, soundVolume: 0.7 },
      });
      handleTick(set, get);
      expect(playNotificationSound).toHaveBeenCalledWith('work', 0.7);
    });

    it('does not play a sound when sound is disabled', () => {
      state = createState({
        pomodoroSeconds: DEFAULT_SETTINGS.pomodoroDuration - 1,
        settings: { ...DEFAULT_SETTINGS, soundEnabled: false },
      });
      handleTick(set, get);
      expect(playNotificationSound).not.toHaveBeenCalled();
    });

    it('does not fire a Notification when the API is unavailable', () => {
      state = createState({ pomodoroSeconds: DEFAULT_SETTINGS.pomodoroDuration - 1 });
      expect(() => handleTick(set, get)).not.toThrow();
      expect(state.showBreakDialog).toBe(true);
    });

    it('fires a granted Notification with the task title interpolated', () => {
      const NotificationMock = vi.fn();
      Object.assign(NotificationMock, { permission: 'granted' });
      window.Notification = NotificationMock as unknown as typeof Notification;

      state = createState({
        pomodoroSeconds: DEFAULT_SETTINGS.pomodoroDuration - 1,
        taskTitle: 'Write tests',
      });
      handleTick(set, get);

      expect(NotificationMock).toHaveBeenCalledWith(
        'Pomodoro complete!',
        expect.objectContaining({ body: 'Write tests — time for a break' }),
      );
    });

    it('falls back to a generic task label when taskTitle is null', () => {
      const NotificationMock = vi.fn();
      Object.assign(NotificationMock, { permission: 'granted' });
      window.Notification = NotificationMock as unknown as typeof Notification;

      state = createState({
        pomodoroSeconds: DEFAULT_SETTINGS.pomodoroDuration - 1,
        taskTitle: null,
      });
      handleTick(set, get);

      expect(NotificationMock).toHaveBeenCalledWith(
        'Pomodoro complete!',
        expect.objectContaining({ body: 'Task — time for a break' }),
      );
    });

    it('does not fire a Notification when permission is not granted', () => {
      const NotificationMock = vi.fn();
      Object.assign(NotificationMock, { permission: 'denied' });
      window.Notification = NotificationMock as unknown as typeof Notification;

      state = createState({ pomodoroSeconds: DEFAULT_SETTINGS.pomodoroDuration - 1 });
      handleTick(set, get);

      expect(NotificationMock).not.toHaveBeenCalled();
    });
  });

  describe('break segment', () => {
    it('increments break seconds without completing the segment', () => {
      state = createState({ isBreakTime: true, pomodoroSeconds: 3, pomodoroCount: 1 });
      handleTick(set, get);
      expect(state.pomodoroSeconds).toBe(4);
      expect(state.showBreakEndDialog).toBe(false);
    });

    it('completes a short break (count not a multiple of 4)', () => {
      state = createState({
        isBreakTime: true,
        pomodoroCount: 1,
        pomodoroSeconds: DEFAULT_SETTINGS.shortBreakDuration - 1,
      });
      handleTick(set, get);
      expect(state.pomodoroSeconds).toBe(DEFAULT_SETTINGS.shortBreakDuration);
      expect(state.showBreakEndDialog).toBe(true);
    });

    it('completes a long break (count is a multiple of 4)', () => {
      state = createState({
        isBreakTime: true,
        pomodoroCount: 4,
        pomodoroSeconds: DEFAULT_SETTINGS.longBreakDuration - 1,
      });
      handleTick(set, get);
      expect(state.pomodoroSeconds).toBe(DEFAULT_SETTINGS.longBreakDuration);
      expect(state.showBreakEndDialog).toBe(true);
    });

    it('plays the break notification sound when sound is enabled', () => {
      state = createState({
        isBreakTime: true,
        pomodoroCount: 1,
        pomodoroSeconds: DEFAULT_SETTINGS.shortBreakDuration - 1,
        settings: { ...DEFAULT_SETTINGS, soundEnabled: true, soundVolume: 0.3 },
      });
      handleTick(set, get);
      expect(playNotificationSound).toHaveBeenCalledWith('break', 0.3);
    });

    it('fires a break-end Notification when permission is granted', () => {
      const NotificationMock = vi.fn();
      Object.assign(NotificationMock, { permission: 'granted' });
      window.Notification = NotificationMock as unknown as typeof Notification;

      state = createState({
        isBreakTime: true,
        pomodoroCount: 1,
        pomodoroSeconds: DEFAULT_SETTINGS.shortBreakDuration - 1,
      });
      handleTick(set, get);

      expect(NotificationMock).toHaveBeenCalledWith(
        'Break over!',
        expect.objectContaining({ body: 'Time to get back to work' }),
      );
    });
  });
});
