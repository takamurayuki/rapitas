/**
 * useHomeFilterHidden.test
 *
 * Hiding the home filter is remembered in this browser, and storage that
 * cannot be read never breaks the toggle (2026-11-21).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHomeFilterHidden } from '../useHomeFilterHidden';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useHomeFilterHidden', () => {
  it('starts shown', () => {
    const { result } = renderHook(() => useHomeFilterHidden());
    expect(result.current[0]).toBe(false);
  });

  it('remembers hiding for the next page load', () => {
    const first = renderHook(() => useHomeFilterHidden());
    act(() => first.result.current[1](true));
    first.unmount();
    const second = renderHook(() => useHomeFilterHidden());
    expect(second.result.current[0]).toBe(true);
  });

  it('forgets it again when shown', () => {
    const first = renderHook(() => useHomeFilterHidden());
    act(() => first.result.current[1](true));
    act(() => first.result.current[1](false));
    first.unmount();
    expect(renderHook(() => useHomeFilterHidden()).result.current[0]).toBe(false);
  });

  it('still toggles when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useHomeFilterHidden());
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });
});
