import { vi } from 'vitest';
import {
  useServerRestartStore,
  isServerRestarting,
  getRestartStartedAt,
  MAX_RESTART_MS,
} from '../server-restart-store';

describe('serverRestartStore', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useServerRestartStore.setState({ isRestarting: false, restartStartedAt: null });
  });

  afterEach(() => {
    // Cancel any pending auto-clear timer leaked into the next test.
    useServerRestartStore.getState().setRestarting(false);
    vi.useRealTimers();
  });

  it('defaults to not restarting', () => {
    expect(useServerRestartStore.getState().isRestarting).toBe(false);
    expect(isServerRestarting()).toBe(false);
  });

  it('setRestarting(true) flips the flag and the non-reactive getter', () => {
    useServerRestartStore.getState().setRestarting(true);
    expect(useServerRestartStore.getState().isRestarting).toBe(true);
    expect(isServerRestarting()).toBe(true);
  });

  it('setRestarting(false) clears the flag', () => {
    useServerRestartStore.getState().setRestarting(true);
    useServerRestartStore.getState().setRestarting(false);
    expect(isServerRestarting()).toBe(false);
  });

  it('auto-clears after the safety window even if reconnect is missed', () => {
    vi.useFakeTimers();
    useServerRestartStore.getState().setRestarting(true);
    expect(isServerRestarting()).toBe(true);
    // Just before the 120s safety net: still restarting.
    vi.advanceTimersByTime(119_000);
    expect(isServerRestarting()).toBe(true);
    // Past it: auto-cleared.
    vi.advanceTimersByTime(2_000);
    expect(isServerRestarting()).toBe(false);
  });

  it('setRestarting(false) cancels the pending auto-clear (no late flip)', () => {
    vi.useFakeTimers();
    useServerRestartStore.getState().setRestarting(true);
    useServerRestartStore.getState().setRestarting(false);
    expect(isServerRestarting()).toBe(false);
    // Advancing past the window must NOT resurrect a stale timer.
    vi.advanceTimersByTime(200_000);
    expect(isServerRestarting()).toBe(false);
  });

  // Task 1548: the API client measures its 2-minute wait from this start time.
  it('exports the 2-minute ceiling the API client waits for', () => {
    expect(MAX_RESTART_MS).toBe(120_000);
  });

  it('records when the restart window opened and forgets it on clear', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(getRestartStartedAt()).toBeNull();
    useServerRestartStore.getState().setRestarting(true);
    expect(getRestartStartedAt()).toBe(1_000_000);
    useServerRestartStore.getState().setRestarting(false);
    expect(getRestartStartedAt()).toBeNull();
  });

  it('a second restarting signal keeps the start time and the original timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    useServerRestartStore.getState().setRestarting(true);
    vi.advanceTimersByTime(60_000);
    useServerRestartStore.getState().setRestarting(true);
    expect(getRestartStartedAt()).toBe(1_000_000);
    // 121 s after the FIRST signal the window closes, not 121 s after the second.
    vi.advanceTimersByTime(61_000);
    expect(isServerRestarting()).toBe(false);
    expect(getRestartStartedAt()).toBeNull();
  });

  it('the auto-clear also forgets the start time', () => {
    vi.useFakeTimers();
    useServerRestartStore.getState().setRestarting(true);
    vi.advanceTimersByTime(MAX_RESTART_MS + 1);
    expect(getRestartStartedAt()).toBeNull();
  });
});
