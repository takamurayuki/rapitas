/**
 * useTransparencyMode.test
 *
 * Verifies the default mode, persistence on toggle, and restoring a
 * previously-stored mode on mount.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransparencyMode } from '../use-transparency-mode';

const STORAGE_KEY = 'rapitas.pomodoroFloat.transparencyMode';

describe('useTransparencyMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
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
});
