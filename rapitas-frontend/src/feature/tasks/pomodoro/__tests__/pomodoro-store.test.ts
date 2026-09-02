/**
 * pomodoro-store tests
 *
 * pomodoro-store.ts mostly orchestrates pomodoro-audio / pomodoro-sync /
 * pomodoro-broadcast / pomodoro-tick, each of which has its own dedicated
 * test file. Those modules are mocked here so this file focuses on the
 * store's own logic: state transitions, the setInterval timer singleton, and
 * the cross-tab BroadcastChannel `onmessage` handler wired up at module load.
 */
const { fakeChannel, getBroadcastChannelMock, broadcastStateMock, closeBroadcastChannelMock } =
  vi.hoisted(() => {
    const fakeChannel: {
      onmessage: ((event: MessageEvent) => void) | null;
      postMessage: (data: unknown) => void;
      close: () => void;
    } = {
      onmessage: null,
      postMessage: vi.fn(),
      close: vi.fn(),
    };
    return {
      fakeChannel,
      getBroadcastChannelMock: vi.fn(() => fakeChannel),
      broadcastStateMock: vi.fn(),
      closeBroadcastChannelMock: vi.fn(),
    };
  });

vi.mock('../pomodoro-broadcast', () => ({
  broadcastState: broadcastStateMock,
  getBroadcastChannel: getBroadcastChannelMock,
  closeBroadcastChannel: closeBroadcastChannelMock,
}));

vi.mock('../pomodoro-audio', () => ({
  getAudioContext: vi.fn(() => null),
  closeAudioContext: vi.fn(),
}));

vi.mock('../pomodoro-sync', () => ({
  syncPomodoroToBackend: {
    start: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn(),
  },
}));

vi.mock('../pomodoro-tick', () => ({
  handleTick: vi.fn(),
}));

import { usePomodoroStore } from '../pomodoro-store';
import { syncPomodoroToBackend } from '../pomodoro-sync';
import { handleTick } from '../pomodoro-tick';
import { DEFAULT_SETTINGS, DEFAULT_LONG_BREAK, DEFAULT_SHORT_BREAK } from '../pomodoro-types';

const store = () => usePomodoroStore.getState();

const INITIAL = {
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
};

describe('pomodoroStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    usePomodoroStore.setState({ ...INITIAL, _hasHydrated: true });
  });

  afterEach(() => {
    // NOTE: the setInterval handle lives in a module-level singleton private
    // to pomodoro-store.ts, shared across every test in this file. Always
    // clearing it via stopTimer() keeps tests independent of run order.
    store().stopTimer();
    vi.useRealTimers();
  });

  it('starts with the documented default state', () => {
    // Re-assert against the raw store defaults (not the beforeEach override)
    // by checking the fields beforeEach doesn't touch.
    expect(store().settings).toEqual(DEFAULT_SETTINGS);
    expect(store()._hasHydrated).toBe(true);
  });

  describe('updateSettings', () => {
    it('merges a partial settings update onto the existing settings', () => {
      store().updateSettings({ soundEnabled: false });
      expect(store().settings).toEqual({ ...DEFAULT_SETTINGS, soundEnabled: false });
    });
  });

  describe('startTimer', () => {
    it('initializes a fresh work session and broadcasts + syncs it', () => {
      store().startTimer(5, 'My Task');
      const s = store();

      expect(s.taskId).toBe(5);
      expect(s.taskTitle).toBe('My Task');
      expect(s.isTimerRunning).toBe(true);
      expect(s.isPaused).toBe(false);
      expect(s.isBreakTime).toBe(false);
      expect(s.pomodoroCount).toBe(0);
      expect(s.pomodoroSeconds).toBe(0);
      expect(s.timerStartTime).not.toBeNull();

      expect(broadcastStateMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: 5 }));
      expect(syncPomodoroToBackend.start).toHaveBeenCalledWith(
        5,
        DEFAULT_SETTINGS.pomodoroDuration,
        'work',
      );
    });

    it('starts the 1s timer interval', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      store().startTimer(1, 'Task');
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    });

    it('starts a taskless session and records it as null in lastUsedTaskId', () => {
      store().startTimer(null, null);
      const s = store();

      expect(s.taskId).toBeNull();
      expect(s.taskTitle).toBeNull();
      expect(s.lastUsedTaskId).toBeNull();
      expect(s.lastUsedTaskTitle).toBeNull();
      expect(s.isTimerRunning).toBe(true);
      expect(syncPomodoroToBackend.start).toHaveBeenCalledWith(
        null,
        DEFAULT_SETTINGS.pomodoroDuration,
        'work',
      );
    });

    it('records the started task as the last used task', () => {
      store().startTimer(5, 'My Task');
      const s = store();

      expect(s.lastUsedTaskId).toBe(5);
      expect(s.lastUsedTaskTitle).toBe('My Task');
    });

    it('resets stale session fields left over from a previous run', () => {
      usePomodoroStore.setState({
        pomodoroCount: 3,
        pomodoroSeconds: 10,
        workSeconds: 20,
        accumulatedBreakSeconds: 30,
        showBreakDialog: true,
      });
      store().startTimer(9, 'Fresh start');
      const s = store();
      expect(s.pomodoroCount).toBe(0);
      expect(s.pomodoroSeconds).toBe(0);
      expect(s.workSeconds).toBe(0);
      expect(s.accumulatedBreakSeconds).toBe(0);
      expect(s.showBreakDialog).toBe(false);
    });
  });

  describe('pauseTimer / resumeTimer', () => {
    it('pauseTimer sets isPaused and broadcasts it', () => {
      store().pauseTimer();
      expect(store().isPaused).toBe(true);
      expect(broadcastStateMock).toHaveBeenCalledWith({ isPaused: true });
    });

    it('resumeTimer clears isPaused and broadcasts it', () => {
      store().pauseTimer();
      store().resumeTimer();
      expect(store().isPaused).toBe(false);
      expect(broadcastStateMock).toHaveBeenCalledWith({ isPaused: false });
    });
  });

  describe('stopTimer', () => {
    it('resets the session back to the idle defaults', () => {
      store().startTimer(2, 'Task');
      store().stopTimer();
      const s = store();
      expect(s.taskId).toBeNull();
      expect(s.isTimerRunning).toBe(false);
      expect(s.timerStartTime).toBeNull();
    });

    it('cancels the backend session', () => {
      store().startTimer(2, 'Task');
      store().stopTimer();
      expect(syncPomodoroToBackend.cancel).toHaveBeenCalledTimes(1);
    });

    it('clears the running interval', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      store().startTimer(2, 'Task');
      store().stopTimer();
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('does not call clearInterval when no timer is running', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      store().stopTimer();
      expect(clearIntervalSpy).not.toHaveBeenCalled();
    });

    it('keeps lastUsedTaskId/lastUsedTaskTitle after stopping', () => {
      store().startTimer(2, 'Task');
      store().stopTimer();
      const s = store();
      expect(s.lastUsedTaskId).toBe(2);
      expect(s.lastUsedTaskTitle).toBe('Task');
    });
  });

  describe('takeBreak', () => {
    it('starts a short break when the new count is not a multiple of 4', () => {
      usePomodoroStore.setState({ pomodoroCount: 0, showBreakDialog: true });
      store().takeBreak();
      const s = store();
      expect(s.pomodoroCount).toBe(1);
      expect(s.isBreakTime).toBe(true);
      expect(s.pomodoroSeconds).toBe(0);
      expect(s.showBreakDialog).toBe(false);
      expect(syncPomodoroToBackend.start).toHaveBeenCalledWith(
        null,
        DEFAULT_SETTINGS.shortBreakDuration,
        'short_break',
      );
    });

    it('starts a long break when the new count is a multiple of 4', () => {
      usePomodoroStore.setState({ pomodoroCount: 3, taskId: 4, showBreakDialog: true });
      store().takeBreak();
      const s = store();
      expect(s.pomodoroCount).toBe(4);
      expect(syncPomodoroToBackend.start).toHaveBeenCalledWith(
        4,
        DEFAULT_SETTINGS.longBreakDuration,
        'long_break',
      );
    });
  });

  describe('skipBreak', () => {
    it('advances the count and clears the break dialog without syncing', () => {
      usePomodoroStore.setState({ pomodoroCount: 1, showBreakDialog: true });
      store().skipBreak();
      const s = store();
      expect(s.pomodoroCount).toBe(2);
      expect(s.pomodoroSeconds).toBe(0);
      expect(s.showBreakDialog).toBe(false);
      expect(syncPomodoroToBackend.start).not.toHaveBeenCalled();
    });
  });

  describe('endBreak', () => {
    it('ends a short break and accumulates DEFAULT_SHORT_BREAK seconds', () => {
      usePomodoroStore.setState({
        pomodoroCount: 1,
        isBreakTime: true,
        accumulatedBreakSeconds: 100,
        showBreakEndDialog: true,
      });
      store().endBreak();
      const s = store();
      expect(s.isBreakTime).toBe(false);
      expect(s.pomodoroSeconds).toBe(0);
      expect(s.accumulatedBreakSeconds).toBe(100 + DEFAULT_SHORT_BREAK);
      expect(s.showBreakEndDialog).toBe(false);
    });

    it('ends a long break and accumulates DEFAULT_LONG_BREAK seconds', () => {
      usePomodoroStore.setState({
        pomodoroCount: 4,
        isBreakTime: true,
        accumulatedBreakSeconds: 0,
      });
      store().endBreak();
      expect(store().accumulatedBreakSeconds).toBe(DEFAULT_LONG_BREAK);
    });
  });

  describe('tick', () => {
    it('delegates to handleTick with the store set/get pair', () => {
      store().tick();
      expect(handleTick).toHaveBeenCalledTimes(1);
      expect(handleTick).toHaveBeenCalledWith(expect.any(Function), expect.any(Function));
    });
  });

  describe('_checkAndResetDailyStats', () => {
    const today = new Date().toISOString().split('T')[0];

    it('resets today-scoped stats when lastStatDate differs from today', () => {
      usePomodoroStore.setState({
        lastStatDate: '2000-01-01',
        todayCompletedPomodoros: 5,
        todayTotalWorkSeconds: 500,
      });
      store()._checkAndResetDailyStats();
      const s = store();
      expect(s.todayCompletedPomodoros).toBe(0);
      expect(s.todayTotalWorkSeconds).toBe(0);
      expect(s.lastStatDate).toBe(today);
    });

    it('leaves stats untouched when lastStatDate already matches today', () => {
      usePomodoroStore.setState({
        lastStatDate: today,
        todayCompletedPomodoros: 5,
        todayTotalWorkSeconds: 500,
      });
      store()._checkAndResetDailyStats();
      const s = store();
      expect(s.todayCompletedPomodoros).toBe(5);
      expect(s.todayTotalWorkSeconds).toBe(500);
    });
  });

  describe('_setHasHydrated', () => {
    it('sets the hydration flag', () => {
      store()._setHasHydrated(false);
      expect(store()._hasHydrated).toBe(false);
    });
  });

  describe('_initializeTimer', () => {
    it('starts the interval when the timer was running but no interval is active', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      usePomodoroStore.setState({ isTimerRunning: true, isPaused: false });
      store()._initializeTimer();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    });

    it('does nothing when the timer is not running', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      usePomodoroStore.setState({ isTimerRunning: false });
      store()._initializeTimer();
      expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    it('does nothing when paused', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      usePomodoroStore.setState({ isTimerRunning: true, isPaused: true });
      store()._initializeTimer();
      expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    it('does not start a second interval when one is already active', () => {
      usePomodoroStore.setState({ isTimerRunning: true, isPaused: false });
      store()._initializeTimer();
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      store()._initializeTimer();
      expect(setIntervalSpy).not.toHaveBeenCalled();
    });
  });

  describe('cross-tab BroadcastChannel sync (module-level onmessage handler)', () => {
    it('ignores messages that are not of type STATE_UPDATE', () => {
      usePomodoroStore.setState({ taskId: 1 });
      fakeChannel.onmessage?.({
        data: { type: 'OTHER', state: { taskId: 999 } },
      } as unknown as MessageEvent);
      expect(store().taskId).toBe(1);
    });

    it('applies an incoming STATE_UPDATE and preserves the local _hasHydrated flag', () => {
      usePomodoroStore.setState({ _hasHydrated: true, taskId: null });
      fakeChannel.onmessage?.({
        data: { type: 'STATE_UPDATE', state: { taskId: 77, isTimerRunning: false } },
      } as unknown as MessageEvent);
      const s = store();
      expect(s.taskId).toBe(77);
      expect(s._hasHydrated).toBe(true);
    });

    it('starts the local interval when the incoming state says the timer is running', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      fakeChannel.onmessage?.({
        data: { type: 'STATE_UPDATE', state: { isTimerRunning: true } },
      } as unknown as MessageEvent);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000);
    });

    it('stops the local interval when the incoming state says the timer stopped', () => {
      fakeChannel.onmessage?.({
        data: { type: 'STATE_UPDATE', state: { isTimerRunning: true } },
      } as unknown as MessageEvent);
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      fakeChannel.onmessage?.({
        data: { type: 'STATE_UPDATE', state: { isTimerRunning: false } },
      } as unknown as MessageEvent);
      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});
