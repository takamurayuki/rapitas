/**
 * useFocusMode.test
 *
 * Verifies the default value, persistence on toggle, restoring a stored
 * value on mount, and the localStorage-unavailable fallback.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFocusMode } from '../use-focus-mode';

const STORAGE_KEY = 'pomodoro-focus';

describe('useFocusMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to false when localStorage is empty', () => {
    const { result } = renderHook(() => useFocusMode());
    expect(result.current.focusMode).toBe(false);
  });

  it('restores a previously-stored "1" as true on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    const { result } = renderHook(() => useFocusMode());
    expect(result.current.focusMode).toBe(true);
  });

  it('toggles and persists the new value to localStorage', () => {
    const { result } = renderHook(() => useFocusMode());
    act(() => {
      result.current.toggleFocusMode();
    });
    expect(result.current.focusMode).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');

    act(() => {
      result.current.toggleFocusMode();
    });
    expect(result.current.focusMode).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0');
  });

  it('falls back to full view when localStorage.getItem throws', () => {
    const spy = vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const { result } = renderHook(() => useFocusMode());
    expect(result.current.focusMode).toBe(false);
    spy.mockRestore();
  });

  it('does not throw when localStorage.setItem fails on toggle', () => {
    const spy = vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    const { result } = renderHook(() => useFocusMode());
    act(() => {
      expect(() => result.current.toggleFocusMode()).not.toThrow();
    });
    expect(result.current.focusMode).toBe(true);
    spy.mockRestore();
  });
});
