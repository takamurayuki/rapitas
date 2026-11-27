'use client';
/**
 * poll-interval
 *
 * Stretches periodic poll intervals while rapitas is in the background
 * (document hidden, or the desktop window minimized — which occlusion-disabled
 * WebView2 does not report via document.hidden). Owns only the interval and
 * the hidden flag; each polling hook still skips its request while hidden and
 * refreshes on return through useOnVisible / subscribeAppHidden.
 *
 * Why: during long parallel auto-runs the desktop WebView2 was ~19% of the
 * 4-core host (2026-11-26, task 1553); timers that wake every few seconds in
 * the background add to that for nothing.
 */
import { useEffect, useState } from 'react';
import { getAppHidden, subscribeAppHidden } from './app-visibility-store';

/** Background polls run this many times less often. */
export const HIDDEN_POLL_MULTIPLIER = 4;
/** Upper bound for a stretched interval (60 s, task 1553 answer 8). */
export const MAX_HIDDEN_POLL_MS = 60_000;

/**
 * Interval to use for a poll given the current visibility.
 *
 * @param baseMs - Interval while visible. / 表示中の間隔
 * @param hidden - Whether rapitas is in the background. / 非表示かどうか
 * @returns Interval in ms (never shorter than baseMs). / 間隔（ms）
 */
export function resolvePollInterval(baseMs: number, hidden: boolean): number {
  if (!hidden) return baseMs;
  return Math.max(baseMs, Math.min(baseMs * HIDDEN_POLL_MULTIPLIER, MAX_HIDDEN_POLL_MS));
}

/**
 * Whether rapitas is in the background right now.
 *
 * @returns true when the document is hidden or the window is minimized. / 非表示なら true
 */
export function isPollHidden(): boolean {
  return (typeof document !== 'undefined' && document.hidden) || getAppHidden();
}

/**
 * React state mirror of isPollHidden, so a polling effect can re-arm its timer
 * when the app goes to / returns from the background.
 *
 * @returns Current background flag. / 現在の非表示状態
 */
export function usePollHidden(): boolean {
  const [hidden, setHidden] = useState(isPollHidden);
  useEffect(() => {
    const update = () => setHidden(isPollHidden());
    update();
    const unsubscribeApp = subscribeAppHidden(update);
    if (typeof document === 'undefined') return unsubscribeApp;
    document.addEventListener('visibilitychange', update);
    return () => {
      unsubscribeApp();
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return hidden;
}
