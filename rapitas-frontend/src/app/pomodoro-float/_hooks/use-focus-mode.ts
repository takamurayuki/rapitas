/**
 * useFocusMode
 *
 * Persists the Pomodoro panel's "focus view" toggle (hide everything but the
 * timer + controls) to localStorage. Migrated verbatim from the deleted
 * global Pomodoro modal so the user's existing `pomodoro-focus` preference
 * carries over unchanged.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'pomodoro-focus';

/**
 * Returns the current focus-mode flag and a toggler that persists the change.
 *
 * @returns Current focus state and a function to flip it / 集中表示の状態と切替関数
 */
export function useFocusMode(): { focusMode: boolean; toggleFocusMode: () => void } {
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    try {
      setFocusMode(localStorage.getItem(STORAGE_KEY) === '1');
    } catch {
      /* storage unavailable — default to full view */
    }
  }, []);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((v) => {
      try {
        localStorage.setItem(STORAGE_KEY, v ? '0' : '1');
      } catch {
        /* best-effort persistence */
      }
      return !v;
    });
  }, []);

  return { focusMode, toggleFocusMode };
}
