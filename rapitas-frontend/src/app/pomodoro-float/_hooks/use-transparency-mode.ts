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
// FIXME: forced to 'opaque' — glass is disabled on this machine. Enabling
// acrylic sets the webview background to alpha-0, which whites out the whole
// window on this WebView2 build (3rd verified occurrence, 2026-09-02; same
// failure as transparent(true)). apply_acrylic() reports success, so the
// frontend cannot detect the white-out and a stored 'glass' bricks the window
// on every launch. Re-enable only after a rework proves see-through works.
const DEFAULT_MODE: TransparencyMode = 'opaque';
const GLASS_DISABLED = true;

/** Whether the glass toggle should be offered in the UI at all. */
export const GLASS_AVAILABLE = !GLASS_DISABLED;

function readStoredMode(): TransparencyMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  if (GLASS_DISABLED) return 'opaque';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'opaque' || stored === 'glass' ? stored : DEFAULT_MODE;
}

const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// NOTE: always_on_top is intentionally opposite of taskbar presence — the
// window builder starts with it false (plan.md 設計判断の根拠 #1) so it never
// fights skip_taskbar(false); glass mode re-enables it as an overlay.
async function syncAlwaysOnTop(mode: TransparencyMode): Promise<void> {
  if (!isTauri()) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_pomodoro_float_always_on_top', { on: mode === 'glass' });
  } catch {
    // Non-fatal — always-on-top is a nicety, not required for correctness.
  }
}

// Applies/clears window-vibrancy acrylic on the Rust side. Never throws to
// the caller — `set_pomodoro_float_acrylic` itself always resolves, but a
// missing/denied command (e.g. capabilities misconfiguration) still throws
// on invoke, so this falls back to `false` rather than propagating.
async function syncAcrylic(mode: TransparencyMode): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<boolean>('set_pomodoro_float_acrylic', { enabled: mode === 'glass' });
  } catch {
    return false;
  }
}

/**
 * Returns the current transparency mode and a toggler that persists the change.
 *
 * @returns Current mode, whether acrylic is actually applied, and a function to flip mode / 現在のモード・acrylic適用可否・切替関数
 */
export function useTransparencyMode(): {
  mode: TransparencyMode;
  acrylicApplied: boolean;
  toggleMode: () => void;
} {
  const [mode, setMode] = useState<TransparencyMode>(DEFAULT_MODE);
  const [acrylicApplied, setAcrylicApplied] = useState(false);

  useEffect(() => {
    setMode(readStoredMode());
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Sequenced (not concurrent) — both resolve the same '@tauri-apps/api/core'
    // dynamic import, and firing them in parallel races that module resolution
    // under Vitest's mock. Sequencing has no functional cost: neither command
    // depends on the other's result (plan.md 設計判断の根拠 「実装者への申し送り事項」#4).
    void syncAlwaysOnTop(mode)
      .then(() => syncAcrylic(mode))
      .then((applied) => {
        if (!cancelled) setAcrylicApplied(applied);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const toggleMode = useCallback(() => {
    if (GLASS_DISABLED) return; // see FIXME at GLASS_DISABLED
    setMode((prev) => {
      const next: TransparencyMode = prev === 'glass' ? 'opaque' : 'glass';
      window.localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { mode, acrylicApplied, toggleMode };
}
