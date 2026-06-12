import { vi } from 'vitest';
import { useServerRestartStore, isServerRestarting } from '../server-restart-store';

describe('serverRestartStore', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useServerRestartStore.setState({ isRestarting: false });
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
});
