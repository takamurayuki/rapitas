import { renderHook } from '@testing-library/react';
import { useSplitViewExit } from '../ui/useSplitViewExit';

describe('useSplitViewExit', () => {
  afterEach(() => {
    // @ts-expect-error test cleanup of injected Tauri marker
    delete window.__TAURI_INTERNALS__;
    // @ts-expect-error test cleanup of split-view marker
    delete window.__RAPITAS_SPLIT_VIEW__;
  });

  it('reports isSplitViewActive false outside Tauri', () => {
    const { result } = renderHook(() => useSplitViewExit());
    expect(result.current.isSplitViewActive).toBe(false);
  });

  it('does not register a keydown listener outside Tauri', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() => useSplitViewExit());
    expect(addSpy).not.toHaveBeenCalledWith('keydown', expect.any(Function));
    addSpy.mockRestore();
  });

  it('reports isSplitViewActive true when the Tauri split-view marker is set', () => {
    // @ts-expect-error injecting Tauri marker for the test
    window.__TAURI_INTERNALS__ = {};
    // @ts-expect-error injecting split-view marker for the test
    window.__RAPITAS_SPLIT_VIEW__ = {};

    const { result } = renderHook(() => useSplitViewExit());
    expect(result.current.isSplitViewActive).toBe(true);
  });

  it('registers and cleans up a keydown listener when running in Tauri', () => {
    // @ts-expect-error injecting Tauri marker for the test
    window.__TAURI_INTERNALS__ = {};
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useSplitViewExit());
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
