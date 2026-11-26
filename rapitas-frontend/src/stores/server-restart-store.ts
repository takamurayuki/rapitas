/**
 * server-restart-store
 *
 * Global "the backend is intentionally restarting" flag. Set when a restart is
 * initiated (header button) or detected (SSE `shutdown` event via
 * useBackendHealth, or the API client's restart wait), cleared on
 * reconnect. Consulted by the logger to silence the expected flood of network
 * errors and by connection-error UI to stay hidden during the restart window.
 */
import { create } from 'zustand';

interface ServerRestartState {
  isRestarting: boolean;
  /** Epoch ms when the current restart window opened; null when not restarting. */
  restartStartedAt: number | null;
  setRestarting: (value: boolean) => void;
}

/**
 * Safety net: never stay suppressed longer than a restart could plausibly take,
 * in case the reconnect signal is missed. Also the API client's wait ceiling —
 * past it, held requests give up and surface their original error (task 1548).
 */
export const MAX_RESTART_MS = 120_000;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

export const useServerRestartStore = create<ServerRestartState>((set, get) => ({
  isRestarting: false,
  restartStartedAt: null,
  setRestarting: (value) => {
    // NOTE: A second "restarting" signal (SSE shutdown + API client) keeps the
    // original start time and timer, so the 2-minute ceiling is not pushed back.
    if (value && get().isRestarting) return;
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    if (value) {
      clearTimer = setTimeout(() => {
        clearTimer = null;
        set({ isRestarting: false, restartStartedAt: null });
      }, MAX_RESTART_MS);
    }
    set({ isRestarting: value, restartStartedAt: value ? Date.now() : null });
  },
}));

/** Non-reactive getter for plain functions (logger, fetch helpers). */
export function isServerRestarting(): boolean {
  return useServerRestartStore.getState().isRestarting;
}

/**
 * Non-reactive getter for when the current restart window opened.
 *
 * @returns Epoch ms, or null when not restarting / 開始時刻（再起動中でなければ null）
 */
export function getRestartStartedAt(): number | null {
  return useServerRestartStore.getState().restartStartedAt;
}
