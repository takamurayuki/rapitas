/**
 * useThemeScroll.test
 *
 * 2026-11-24: the home theme row's "<" / ">" buttons stopped appearing. The
 * filter can be folded away (#26531c23d, 2026-11-21) and the folded state is
 * saved, so the page often starts with no theme row at all. Showing the
 * filter mounted the row, but the hook only measured it when the theme list
 * or the category changed, so it kept reporting "no scroll needed" and the
 * buttons never rendered.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeScroll } from '../useThemeScroll';

const THEMES = ['a', 'b', 'c'];

function Harness({ hidden }: { hidden: boolean }) {
  // Same deps as HomeClientPage passes: the theme list and the category.
  const { themeScrollRef, isScrollNeeded } = useThemeScroll([THEMES, 1]);
  return (
    <>
      <span data-testid="needed">{String(isScrollNeeded)}</span>
      {!hidden && <div ref={themeScrollRef} data-testid="row" />}
    </>
  );
}

describe('useThemeScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom lays nothing out; make every element overflow its box.
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    if (!('ResizeObserver' in globalThis)) {
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        },
      );
    }
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports an overflowing row that is there from the start', () => {
    const { getByTestId } = render(<Harness hidden={false} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(getByTestId('needed').textContent).toBe('true');
  });

  it('measures the row again when it appears after starting hidden', () => {
    const { getByTestId, rerender } = render(<Harness hidden />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(getByTestId('needed').textContent).toBe('false');

    rerender(<Harness hidden={false} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(getByTestId('needed').textContent).toBe('true');
  });
});
