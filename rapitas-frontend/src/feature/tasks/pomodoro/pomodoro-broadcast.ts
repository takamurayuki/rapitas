/**
 * pomodoroBroadcast
 *
 * BroadcastChannel utilities for cross-tab Pomodoro state synchronisation.
 * Provides a lazy-initialised channel singleton and a helper to post state updates.
 */

import type { PomodoroState } from './pomodoro-types';

// NOTE: Singleton pinned to globalThis, NOT module scope — Next dev HMR
// re-evaluates this module, and a module-scope variable resets while the old
// channel (and its onmessage handler) lives on. Each hot update then added
// one more channel per window; every broadcast fanned out to all of them and
// the resulting setState/render storm pegged WebView2 (2026-09-03 root cause
// of the recurring CPU spikes).
const g = globalThis as unknown as { __rapitasPomodoroChannel?: BroadcastChannel | null };

/**
 * Returns (and lazily creates) the shared BroadcastChannel for Pomodoro sync.
 * Returns null in SSR environments where window is not available.
 *
 * @returns BroadcastChannel or null / BroadcastChannelまたはnull
 */
export const getBroadcastChannel = (): BroadcastChannel | null => {
  if (typeof window === 'undefined') return null;
  if (!g.__rapitasPomodoroChannel) {
    g.__rapitasPomodoroChannel = new BroadcastChannel('pomodoro-sync');
  }
  return g.__rapitasPomodoroChannel;
};

/**
 * Closes the shared BroadcastChannel and nulls the singleton.
 * Called on beforeunload to avoid lingering listeners.
 */
export const closeBroadcastChannel = (): void => {
  if (g.__rapitasPomodoroChannel) {
    g.__rapitasPomodoroChannel.close();
    g.__rapitasPomodoroChannel = null;
  }
};

/**
 * Posts a partial state update to all other tabs listening on the pomodoro-sync channel.
 *
 * @param state - Partial state snapshot to broadcast / ブロードキャストする部分的な状態
 */
export const broadcastState = (state: Partial<PomodoroState>): void => {
  const channel = getBroadcastChannel();
  if (channel) {
    channel.postMessage({ type: 'STATE_UPDATE', state });
  }
};
