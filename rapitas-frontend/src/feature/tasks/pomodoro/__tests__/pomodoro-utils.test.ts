import { formatTime, getRemainingTime } from '../pomodoro-utils';
import { DEFAULT_SETTINGS } from '../pomodoro-types';

describe('formatTime', () => {
  it('formats 0 seconds as 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats sub-minute seconds with zero-padded seconds', () => {
    expect(formatTime(5)).toBe('0:05');
  });

  it('formats minutes and seconds as M:SS', () => {
    expect(formatTime(65)).toBe('1:05');
  });

  it('formats exactly one hour boundary as H:MM:SS', () => {
    expect(formatTime(3600)).toBe('1:00:00');
  });

  it('formats durations under an hour without an hours segment', () => {
    expect(formatTime(3599)).toBe('59:59');
  });

  it('formats durations over an hour as H:MM:SS', () => {
    expect(formatTime(3661)).toBe('1:01:01');
  });

  it('formats multi-hour durations', () => {
    expect(formatTime(7325)).toBe('2:02:05');
  });
});

describe('getRemainingTime', () => {
  it('computes remaining work time using explicit settings', () => {
    const remaining = getRemainingTime({
      isBreakTime: false,
      pomodoroCount: 0,
      pomodoroSeconds: 100,
      settings: DEFAULT_SETTINGS,
    });
    expect(remaining).toBe(DEFAULT_SETTINGS.pomodoroDuration - 100);
  });

  it('falls back to DEFAULT_SETTINGS when settings is omitted', () => {
    const remaining = getRemainingTime({
      isBreakTime: false,
      pomodoroCount: 0,
      pomodoroSeconds: 0,
    });
    expect(remaining).toBe(DEFAULT_SETTINGS.pomodoroDuration);
  });

  it('uses shortBreakDuration when pomodoroCount is not a multiple of 4', () => {
    const remaining = getRemainingTime({
      isBreakTime: true,
      pomodoroCount: 1,
      pomodoroSeconds: 10,
      settings: DEFAULT_SETTINGS,
    });
    expect(remaining).toBe(DEFAULT_SETTINGS.shortBreakDuration - 10);
  });

  it('uses longBreakDuration when pomodoroCount is a multiple of 4', () => {
    const remaining = getRemainingTime({
      isBreakTime: true,
      pomodoroCount: 4,
      pomodoroSeconds: 10,
      settings: DEFAULT_SETTINGS,
    });
    expect(remaining).toBe(DEFAULT_SETTINGS.longBreakDuration - 10);
  });

  it('treats pomodoroCount 0 as a long break (0 % 4 === 0)', () => {
    const remaining = getRemainingTime({
      isBreakTime: true,
      pomodoroCount: 0,
      pomodoroSeconds: 0,
      settings: DEFAULT_SETTINGS,
    });
    expect(remaining).toBe(DEFAULT_SETTINGS.longBreakDuration);
  });

  it('can return a negative value once the segment has overrun', () => {
    const remaining = getRemainingTime({
      isBreakTime: false,
      pomodoroCount: 0,
      pomodoroSeconds: DEFAULT_SETTINGS.pomodoroDuration + 5,
      settings: DEFAULT_SETTINGS,
    });
    expect(remaining).toBe(-5);
  });
});
