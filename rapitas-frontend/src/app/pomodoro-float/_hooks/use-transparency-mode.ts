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

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// NOTE: always_on_top is intentionally opposite of taskbar presence — the
// window builder starts with it false (plan.md 設計判断の根拠 #1) so it never
// fights skip_taskbar(false); glass mode re-enables it as an overlay.
async function syncAlwaysOnTop(mode: TransparencyMode): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_pomodoro_float_always_on_top', { on: mode === 'glass' });
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

  useEffect(() => {
    void syncAlwaysOnTop(mode);
  }, [mode]);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next: TransparencyMode = prev === 'glass' ? 'opaque' : 'glass';
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { mode, toggleMode };
}
