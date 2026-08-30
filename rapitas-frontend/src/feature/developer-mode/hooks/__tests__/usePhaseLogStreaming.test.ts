/**
 * usePhaseLogStreaming unit tests
 *
 * Verifies the three running-phase tail-follow behaviors task #785 requires:
 * auto-scroll on new lines, auto-scroll stopping once the user scrolls away
 * from the bottom, and resuming via scrollToBottom() (the "末尾へ" button).
 */
import { renderHook, act } from '@testing-library/react';
import { usePhaseLogStreaming } from '../usePhaseLogStreaming';

function makeContainer(overrides: Partial<HTMLElement> = {}) {
  return {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 500,
    scrollTo: vi.fn(),
    ...overrides,
  } as unknown as HTMLElement;
}

describe('usePhaseLogStreaming', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-scrolls to the bottom when new log lines arrive while autoScroll is on', () => {
    const container = makeContainer();
    const ref = { current: container };

    const { rerender } = renderHook(({ count }) => usePhaseLogStreaming(count, ref), {
      initialProps: { count: 5 },
    });

    rerender({ count: 6 });
    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(container.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
  });

  it('stops auto-scroll once the user scrolls away from the bottom', () => {
    const container = makeContainer({ scrollTop: 0 }); // far from bottom: 1000-0-500=500 > 50
    const ref = { current: container };

    const { result, rerender } = renderHook(({ count }) => usePhaseLogStreaming(count, ref), {
      initialProps: { count: 5 },
    });

    act(() => {
      result.current.handleScrollStart();
      result.current.handleScroll();
      result.current.handleScrollEnd();
    });

    expect(result.current.autoScroll).toBe(false);

    // New lines arrive — should NOT auto-scroll anymore.
    rerender({ count: 6 });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(container.scrollTo).not.toHaveBeenCalled();
  });

  it('resumes auto-scroll via scrollToBottom (the 末尾へ button)', () => {
    const container = makeContainer({ scrollTop: 0 });
    const ref = { current: container };

    const { result } = renderHook(() => usePhaseLogStreaming(5, ref));

    act(() => {
      result.current.handleScrollStart();
      result.current.handleScroll();
      result.current.handleScrollEnd();
    });
    expect(result.current.autoScroll).toBe(false);

    act(() => {
      result.current.scrollToBottom();
    });

    expect(container.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' });
    expect(result.current.autoScroll).toBe(true);
  });
});
