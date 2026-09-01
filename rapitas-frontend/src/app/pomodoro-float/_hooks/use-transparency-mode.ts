/**
 * useTransparencyMode
 *
 * Persists the Pomodoro floating window's glass-vs-opaque display mode to
 * localStorage under a dedicated key so it survives closing/reopening the
 * window (does not touch the `pomodoro-storage` timer-state key).
 */
'use client';

import { useCallback, useEffect, useState } from 'react';

export type TransparencyMode = 'glass' | 'opaque';

const STORAGE_KEY = 'rapitas.pomodoroFloat.transparencyMode';
const DEFAULT_MODE: TransparencyMode = 'glass';

function readStoredMode(): TransparencyMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'opaque' || stored === 'glass' ? stored : DEFAULT_MODE;
}

/**
 * Returns the current transparency mode and a toggler that persists the change.
 *
 * @returns Current mode and a function to flip it / 現在のモードと切替関数
 */
export function useTransparencyMode(): { mode: TransparencyMode; toggleMode: () => void } {
  const [mode, setMode] = useState<TransparencyMode>(DEFAULT_MODE);

  useEffect(() => {
    setMode(readStoredMode());
  }, []);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next: TransparencyMode = prev === 'glass' ? 'opaque' : 'glass';
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { mode, toggleMode };
}
