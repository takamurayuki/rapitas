/**
 * pomodoroBroadcast
 *
 * BroadcastChannel utilities for cross-tab Pomodoro state synchronisation.
 * Provides a lazy-initialised channel singleton and a helper to post state updates.
 */

import type { PomodoroState } from './pomodoro-types';

// NOTE: Module-level singleton so all callers share the same channel instance.
let broadcastChannel: BroadcastChannel | null = null;

/**
 * Returns (and lazily creates) the shared BroadcastChannel for Pomodoro sync.
 * Returns null in SSR environments where window is not available.
 *
 * @returns BroadcastChannel or null / BroadcastChannelまたはnull
 */
export const getBroadcastChannel = (): BroadcastChannel | null => {
  if (typeof window === 'undefined') return null;
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel('pomodoro-sync');
  }
  return broadcastChannel;
};

/**
 * Closes the shared BroadcastChannel and nulls the singleton.
 * Called on beforeunload to avoid lingering listeners.
 */
export const closeBroadcastChannel = (): void => {
  if (broadcastChannel) {
    broadcastChannel.close();
    broadcastChannel = null;
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
