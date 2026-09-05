/**
 * useTransparencyMode.test
 *
 * Verifies the default mode, persistence on toggle, restoring a
 * previously-stored mode on mount, and the acrylic invoke/fallback wiring.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTransparencyMode } from '../use-transparency-mode';

const STORAGE_KEY = 'rapitas.pomodoroFloat.transparencyMode';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));

describe('useTransparencyMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockInvoke.mockClear();
    mockInvoke.mockReset();
  });

  afterEach(() => {
    // @ts-expect-error test cleanup of injected Tauri marker
    delete window.__TAURI_INTERNALS__;
  });

  it('defaults to "opaque" (glass is disabled — alpha-0 background whites out this WebView2)', () => {
    const { result } = renderHook(() => useTransparencyMode());
    expect(result.current.mode).toBe('opaque');
  });

  it('toggleMode is inert while glass is disabled', () => {
    const { result } = renderHook(() => useTransparencyMode());
    act(() => {
      result.current.toggleMode();
    });
    expect(result.current.mode).toBe('opaque');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ignores a stored "glass" mode while glass is disabled (self-heals a bricked window)', () => {
    window.localStorage.setItem(STORAGE_KEY, 'glass');
    const { result } = renderHook(() => useTransparencyMode());
    expect(result.current.mode).toBe('opaque');
  });

  it('does not invoke the always-on-top or acrylic commands outside a Tauri environment', async () => {
    const { result } = renderHook(() => useTransparencyMode());
    await act(async () => {
      result.current.toggleMode();
      await Promise.resolve();
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.current.acrylicApplied).toBe(false);
  });

  describe('Tauri環境でのacrylic連携', () => {
    beforeEach(() => {
      // @ts-expect-error injecting a minimal Tauri internals stub for the test
      window.__TAURI_INTERNALS__ = {};
    });

    it('マウント時にset_pomodoro_float_acrylicをenabled=falseで呼び、白化した背景をリセットすること', async () => {
      // Glass is disabled: the mount-time sync must actively CLEAR any alpha-0
      // webview background left by an earlier glass session (self-heal path).
      mockInvoke.mockImplementation(
        async (_cmd: string, args: { enabled?: boolean } = {}) => args.enabled === true,
      );
      const { result } = renderHook(() => useTransparencyMode());

      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('set_pomodoro_float_acrylic', { enabled: false }),
      );
      await waitFor(() => expect(result.current.acrylicApplied).toBe(false));
      expect(mockInvoke).not.toHaveBeenCalledWith('set_pomodoro_float_acrylic', { enabled: true });
    });

    it('invokeがfalseを返す場合acrylicAppliedがfalseになること', async () => {
      mockInvoke.mockResolvedValue(false);
      const { result } = renderHook(() => useTransparencyMode());

      await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
      await waitFor(() => expect(result.current.acrylicApplied).toBe(false));
    });

    it('invokeが例外を投げてもacrylicAppliedがfalseになり例外が外部に伝播しないこと', async () => {
      mockInvoke.mockRejectedValue(new Error('command not found'));
      const { result } = renderHook(() => useTransparencyMode());

      await waitFor(() => expect(mockInvoke).toHaveBeenCalled());
      await waitFor(() => expect(result.current.acrylicApplied).toBe(false));
    });
  });
});
