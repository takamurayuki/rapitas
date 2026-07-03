import { renderHook } from '@testing-library/react';
import { useOnVisible } from '../common/useOnVisible';

describe('useOnVisible', () => {
  const setHidden = (hidden: boolean) => {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
  };

  afterEach(() => {
    setHidden(false);
  });

  it('invokes the callback when visibilitychange fires while visible', () => {
    const cb = vi.fn();
    renderHook(() => useOnVisible(cb));

    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the callback when the document is hidden', () => {
    const cb = vi.fn();
    renderHook(() => useOnVisible(cb));

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(cb).not.toHaveBeenCalled();
  });

  it('always calls the latest callback (ref pattern)', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(({ cb }) => useOnVisible(cb), { initialProps: { cb: cb1 } });

    rerender({ cb: cb2 });
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('removes the listener on unmount', () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => useOnVisible(cb));
    unmount();

    document.dispatchEvent(new Event('visibilitychange'));
    expect(cb).not.toHaveBeenCalled();
  });
});
