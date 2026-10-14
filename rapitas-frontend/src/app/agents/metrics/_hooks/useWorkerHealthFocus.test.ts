/**
 * useWorkerHealthFocus tests
 *
 * Verifies the alert deep link pre-selects the metric and scrolls the card,
 * only after the panel is ready, and that a plain visit changes nothing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkerHealthFocus } from './useWorkerHealthFocus';

afterEach(() => {
  window.history.replaceState({}, '', '/');
  document.body.innerHTML = '';
});

describe('useWorkerHealthFocus', () => {
  it('selects the linked metric and scrolls once ready', () => {
    window.history.replaceState({}, '', '/agents/metrics?panel=worker-health&metric=restarts');
    const el = document.createElement('section');
    el.id = 'worker-health';
    const scroll = vi.fn();
    el.scrollIntoView = scroll;
    document.body.appendChild(el);

    const { result, rerender } = renderHook(({ ready }) => useWorkerHealthFocus(ready), {
      initialProps: { ready: false },
    });
    expect(result.current.selectedMetric).toBeNull();
    expect(scroll).not.toHaveBeenCalled();

    rerender({ ready: true });
    expect(result.current.selectedMetric).toBe('restarts');
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a visit without the panel query', () => {
    const { result } = renderHook(() => useWorkerHealthFocus(true));
    expect(result.current.selectedMetric).toBeNull();
  });

  it('lets the user change the selection afterwards', () => {
    window.history.replaceState({}, '', '/?panel=worker-health&metric=restarts');
    const { result } = renderHook(() => useWorkerHealthFocus(true));
    act(() => result.current.setSelectedMetric('retryRate'));
    expect(result.current.selectedMetric).toBe('retryRate');
  });
});
