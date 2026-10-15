/**
 * useFloatPageBackground.test
 *
 * Verifies html/body background is forced transparent in glass mode, left at
 * the stylesheet default in opaque mode, and cleared again on unmount.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFloatPageBackground } from '../use-float-page-background';
import type { TransparencyMode } from '../use-transparency-mode';

describe('useFloatPageBackground', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('background');
    document.body.style.removeProperty('background');
  });

  it('sets html/body background to transparent in glass mode', () => {
    renderHook(() => useFloatPageBackground('glass'));
    expect(document.documentElement.style.background).toBe('transparent');
    expect(document.body.style.background).toBe('transparent');
  });

  it('leaves html/body background unset in opaque mode', () => {
    renderHook(() => useFloatPageBackground('opaque'));
    expect(document.documentElement.style.background).toBe('');
    expect(document.body.style.background).toBe('');
  });

  it('clears the transparent override when switching from glass to opaque', () => {
    const { rerender } = renderHook(
      ({ mode }: { mode: TransparencyMode }) => useFloatPageBackground(mode),
      { initialProps: { mode: 'glass' as TransparencyMode } },
    );
    expect(document.body.style.background).toBe('transparent');

    rerender({ mode: 'opaque' as TransparencyMode });
    expect(document.body.style.background).toBe('');
  });

  it('clears the override on unmount', () => {
    const { unmount } = renderHook(() => useFloatPageBackground('glass'));
    expect(document.body.style.background).toBe('transparent');

    unmount();
    expect(document.body.style.background).toBe('');
  });
});
