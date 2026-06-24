/**
 * header/__tests__/use-click-outside.test.ts
 *
 * Unit tests for the useClickOutside hook.
 * Verifies that the mousedown listener is attached only when enabled,
 * fires the callback only for clicks outside the ref element,
 * and cleans up on unmount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useClickOutside } from '../useClickOutside';

describe('useClickOutside', () => {
  let container: HTMLDivElement;
  let outsideElement: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    outsideElement = document.createElement('div');
    document.body.appendChild(container);
    document.body.appendChild(outsideElement);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('does not call the callback when enabled is false', () => {
    const callback = vi.fn();
    const ref = { current: container };

    renderHook(() => useClickOutside(ref, callback, false));

    fireEvent.mouseDown(outsideElement);
    expect(callback).not.toHaveBeenCalled();
  });

  it('calls the callback when clicking outside the ref element', () => {
    const callback = vi.fn();
    const ref = { current: container };

    renderHook(() => useClickOutside(ref, callback, true));

    fireEvent.mouseDown(outsideElement);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('does not call the callback when clicking inside the ref element', () => {
    const callback = vi.fn();
    const innerElement = document.createElement('span');
    container.appendChild(innerElement);
    const ref = { current: container };

    renderHook(() => useClickOutside(ref, callback, true));

    fireEvent.mouseDown(innerElement);
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not call the callback when clicking the ref element itself', () => {
    const callback = vi.fn();
    const ref = { current: container };

    renderHook(() => useClickOutside(ref, callback, true));

    fireEvent.mouseDown(container);
    expect(callback).not.toHaveBeenCalled();
  });

  it('removes the event listener on unmount', () => {
    const callback = vi.fn();
    const ref = { current: container };
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderHook(() => useClickOutside(ref, callback, true));
    unmount();

    expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
    removeSpy.mockRestore();
  });

  it('stops calling the callback after being disabled (re-render with enabled=false)', () => {
    const callback = vi.fn();
    const ref = { current: container };

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useClickOutside(ref, callback, enabled),
      { initialProps: { enabled: true } },
    );

    fireEvent.mouseDown(outsideElement);
    expect(callback).toHaveBeenCalledTimes(1);

    rerender({ enabled: false });

    fireEvent.mouseDown(outsideElement);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
