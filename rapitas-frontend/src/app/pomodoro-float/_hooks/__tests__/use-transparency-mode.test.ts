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

  it('defaults to "glass" when localStorage is empty', () => {
    const { result } = renderHook(() => useTransparencyMode());
    expect(result.current.mode).toBe('glass');
  });

  it('persists "opaque" to localStorage after toggling once', () => {
    const { result } = renderHook(() => useTransparencyMode());
    act(() => {
      result.current.toggleMode();
    });
    expect(result.current.mode).toBe('opaque');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('opaque');
  });

  it('restores a previously-stored mode on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'opaque');
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

    it('mode変更時にset_pomodoro_float_acrylicをenabled=trueで呼び、成功時にacrylicAppliedがtrueになること', async () => {
      mockInvoke.mockResolvedValue(true);
      const { result } = renderHook(() => useTransparencyMode());

      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('set_pomodoro_float_acrylic', { enabled: true }),
      );
      await waitFor(() => expect(result.current.acrylicApplied).toBe(true));
    });

    it('opaqueへ切替時はenabled=falseで呼び、acrylicAppliedがfalseになること', async () => {
      // Mirrors the real command's contract: acrylicApplied always tracks
      // enabled — this is what caught the disable-path Ok(true) return bug.
      mockInvoke.mockImplementation(
        async (_cmd: string, args: { enabled?: boolean } = {}) => args.enabled === true,
      );
      const { result } = renderHook(() => useTransparencyMode());
      await waitFor(() => expect(result.current.acrylicApplied).toBe(true));

      mockInvoke.mockClear();
      act(() => {
        result.current.toggleMode();
      });

      await waitFor(() =>
        expect(mockInvoke).toHaveBeenCalledWith('set_pomodoro_float_acrylic', { enabled: false }),
      );
      await waitFor(() => expect(result.current.acrylicApplied).toBe(false));
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
