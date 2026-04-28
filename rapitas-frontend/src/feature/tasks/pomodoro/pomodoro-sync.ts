/**
 * pomodoroSync
 *
 * Backend synchronisation helpers for Pomodoro session state.
 * All fetch calls are fire-and-forget — failures are silently swallowed
 * because backend sync is non-critical to the local timer UX.
 */

import { API_BASE_URL } from '@/utils/api';

/**
 * Sync object with methods to notify the backend about Pomodoro session events.
 * Each method fires an async request without blocking the caller.
 */
export const syncPomodoroToBackend = {
  /**
   * Notifies the backend that a new Pomodoro or break segment has started.
   *
   * @param taskId - Associated task ID, or null if no task is selected / 関連タスクID
   * @param duration - Segment duration in seconds / セグメントの長さ（秒）
   * @param type - Session type / セッション種別
   */
  start: (
    taskId: number | null,
    duration: number,
    type: 'work' | 'short_break' | 'long_break' = 'work',
  ): void => {
    fetch(`${API_BASE_URL}/pomodoro/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, duration, type }),
    }).catch(() => {});
  },

  /**
   * Marks the currently active backend session as completed.
   *
   * @param completedPomodoros - Total completed pomodoros so far (unused server-side, kept for context) / 完了ポモドーロ数
   */
  complete: (completedPomodoros: number): void => {
    fetch(`${API_BASE_URL}/pomodoro/active`)
      .then((res) => res.json())
      .then((data: { session?: { id: number } }) => {
        if (data.session?.id) {
          return fetch(`${API_BASE_URL}/pomodoro/sessions/${data.session.id}/complete`, {
            method: 'POST',
          });
        }
      })
      .catch(() => {});
    // NOTE: completedPomodoros is passed in for future server-side tracking; currently unused.
    void completedPomodoros;
  },

  /**
   * Cancels the currently active backend session.
   */
  cancel: (): void => {
    fetch(`${API_BASE_URL}/pomodoro/active`)
      .then((res) => res.json())
      .then((data: { session?: { id: number } }) => {
        if (data.session?.id) {
          return fetch(`${API_BASE_URL}/pomodoro/sessions/${data.session.id}/cancel`, {
            method: 'POST',
          });
        }
      })
      .catch(() => {});
  },
};
