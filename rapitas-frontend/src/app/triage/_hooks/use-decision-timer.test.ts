import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDecisionTimer } from './use-decision-timer';
import { useDecisionDurationStore } from '@/stores/decision-duration-store';

const MIN = 60_000;

describe('useDecisionTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useDecisionDurationStore.getState().clear();
  });
  afterEach(() => vi.useRealTimers());

  it('records one entry with the kind and elapsed ms on start -> finish', () => {
    const { result } = renderHook(() => useDecisionTimer({ itemId: 1, kind: 'k' }));
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    act(() => result.current.finish());
    expect(useDecisionDurationStore.getState().durations).toEqual({ k: [4000] });
    expect(result.current.running).toBe(false);
  });

  it('records nothing on discard or unmount', () => {
    const { result, unmount } = renderHook(() => useDecisionTimer({ itemId: 1, kind: 'k' }));
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    act(() => result.current.discard());
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    unmount();
    expect(useDecisionDurationStore.getState().durations).toEqual({});
  });

  it('records once under the previous kind when itemId changes while running', () => {
    const { result, rerender } = renderHook((p) => useDecisionTimer(p), {
      initialProps: { itemId: 1, kind: 'old' },
    });
    act(() => result.current.start());
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    rerender({ itemId: 2, kind: 'new' });
    expect(useDecisionDurationStore.getState().durations).toEqual({ old: [6000] });
    expect(result.current.running).toBe(false);
  });

  it('hides the estimate under 5 samples and shows minutes at 5', () => {
    const rec = useDecisionDurationStore.getState().record;
    for (let i = 0; i < 4; i++) rec('k', 4 * MIN);
    const { result } = renderHook(() => useDecisionTimer({ itemId: 1, kind: 'k' }));
    expect(result.current.estimateMinutes).toBeNull();
    act(() => rec('k', 4 * MIN));
    expect(result.current.estimateMinutes).toBe(4);
  });
});
