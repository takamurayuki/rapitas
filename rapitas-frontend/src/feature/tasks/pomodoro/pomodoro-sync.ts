/**
 * pomodoroSync
 *
 * Backend synchronisation helpers for Pomodoro session state.
 * All fetch calls are fire-and-forget — failures are silently swallowed
 * because backend sync is non-critical to the local timer UX.
 */

import { API_BASE_URL } from '@/utils/api';

/**
 * Whether this window may talk to the backend about pomodoro state.
 * The pomodoro store (and its 1s tick) runs in EVERY window — the root layout
 * wraps the popup windows too — so without this gate, the main window, the
 * notification toast, and quick capture ALL fired start/complete/cancel for
 * the same session (server log: 「完了可能なセッションが見つかりません」races
 * on completion). Only the main window owns backend sync.
 */
const isSyncOwner = (): boolean =>
  typeof window === 'undefined' ||
  !['/notification-toast', '/quick-capture'].some((p) => window.location.pathname.startsWith(p));

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
    if (!isSyncOwner()) return;
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
    if (!isSyncOwner()) return;
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
    if (!isSyncOwner()) return;
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

  /**
   * Records study time for the active session's elapsed-so-far without
   * changing its status. Unlike the fire-and-forget methods above, the
   * caller needs the recorded minute count to show a toast — so this
   * resolves with the result instead of returning void.
   *
   * @returns Recorded minutes, or null when there is no active session, the
   * call is not the sync owner, or the request failed / 記録分数(no-op時はnull)
   */
  checkpoint: async (): Promise<{ studyMinutesRecorded: number } | null> => {
    if (!isSyncOwner()) return null;
    try {
      const activeRes = await fetch(`${API_BASE_URL}/pomodoro/active`);
      const activeData = (await activeRes.json()) as { session?: { id: number } };
      const sessionId = activeData.session?.id;
      if (!sessionId) return null;

      const res = await fetch(`${API_BASE_URL}/pomodoro/sessions/${sessionId}/checkpoint`, {
        method: 'POST',
      });
      if (!res.ok) return null;

      const data = (await res.json()) as { success: boolean; studyMinutesRecorded?: number };
      if (!data.success || typeof data.studyMinutesRecorded !== 'number') return null;
      return { studyMinutesRecorded: data.studyMinutesRecorded };
    } catch {
      return null;
    }
  },
};
