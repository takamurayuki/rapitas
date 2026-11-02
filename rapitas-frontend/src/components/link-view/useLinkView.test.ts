/**
 * useLinkView.test
 *
 * Two things here are worth pinning. A desktop build made before tauri's
 * `unstable` feature has no link-view command, so the dock fails and the
 * link must still go somewhere — without that, the setting is switchable,
 * the link is clicked, and nothing happens at all. And switching tabs must
 * not re-open a page that is already built, or a tab would lose its scroll
 * position every time it is left.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { LinkTab } from '@/stores/link-view-store';

const openLinkView = vi.fn();
const setLinkViewVisible = vi.fn();
const setLinkViewBounds = vi.fn();
const closeLinkView = vi.fn();
const unlistenPageChanged = vi.fn();
/** The handler the hook registered, so a test can play the webview. */
let pageChangedHandler: ((event: LinkViewPageChange) => void) | null = null;

vi.mock('@/utils/link-view', () => ({
  openLinkView: (...args: unknown[]) => openLinkView(...args),
  setLinkViewBounds: (...args: unknown[]) => setLinkViewBounds(...args),
  setLinkViewVisible: (...args: unknown[]) => setLinkViewVisible(...args),
  closeLinkView: (...args: unknown[]) => closeLinkView(...args),
  linkViewHistory: vi.fn().mockResolvedValue(true),
  onLinkViewPageChanged: (handler: (event: LinkViewPageChange) => void) => {
    pageChangedHandler = handler;
    return Promise.resolve(unlistenPageChanged);
  },
}));

import { useLinkView } from './useLinkView';
import type { LinkViewPageChange } from '@/utils/link-view';
import type { LinkPageChange } from './link-tab-meta';

const TABS: LinkTab[] = [
  { id: 't1', url: 'https://one.example' },
  { id: 't2', url: 'https://two.example' },
];

/** Give the hook a placeholder with a real box, as the pane does. */
function attach(ref: React.RefObject<HTMLDivElement | null>) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 600 }) as DOMRect;
  document.body.appendChild(el);
  ref.current = el;
}

/** Render with the placeholder attached before the docking effect runs. */
function renderWithBox(
  tabs: LinkTab[],
  activeId: string | null,
  onUnavailable?: (url: string) => void,
  onPageChange?: (tabId: string, change: LinkPageChange) => void,
) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 600 }) as DOMRect;
  document.body.appendChild(el);

  return renderHook(
    ({ t, a }: { t: LinkTab[]; a: string | null }) => {
      const view = useLinkView(t, a, onUnavailable, onPageChange);
      // The pane assigns this during render; mirror that ordering.
      view.placeholderRef.current = el;
      return view;
    },
    { initialProps: { t: tabs, a: activeId } },
  );
}

// Module scope on purpose: a beforeEach inside one describe does not reach
// the others, and counts then accumulate across the file — which is exactly
// how these tests first went wrong (7 calls where 1 was expected).
beforeEach(() => {
  openLinkView.mockReset().mockResolvedValue(true);
  setLinkViewVisible.mockReset().mockResolvedValue(true);
  setLinkViewBounds.mockReset().mockResolvedValue(true);
  closeLinkView.mockReset().mockResolvedValue(true);
  unlistenPageChanged.mockReset();
  pageChangedHandler = null;
  document.body.innerHTML = '';
});

describe('useLinkView', () => {
  it('docks the active tab at the placeholder box', async () => {
    const { result } = renderWithBox(TABS, 't1');
    attach(result.current.placeholderRef);

    await waitFor(() =>
      expect(openLinkView).toHaveBeenCalledWith('t1', 'https://one.example', {
        x: 100,
        y: 50,
        width: 400,
        height: 600,
      }),
    );
  });

  it('hands the URL back when it cannot be docked', async () => {
    openLinkView.mockResolvedValue(false);
    const onUnavailable = vi.fn();
    renderWithBox(TABS, 't1', onUnavailable);
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith('https://one.example'));
  });

  it('does not hand back a tab that docked fine', async () => {
    const onUnavailable = vi.fn();
    renderWithBox(TABS, 't1', onUnavailable);
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());
    expect(onUnavailable).not.toHaveBeenCalled();
  });

  // The whole point of a tab: coming back to it must not reload the page.
  it('opens each tab once and only shows it again on return', async () => {
    const { rerender } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalledTimes(1));

    rerender({ t: TABS, a: 't2' });
    await waitFor(() => expect(openLinkView).toHaveBeenCalledTimes(2));

    openLinkView.mockClear();
    rerender({ t: TABS, a: 't1' });
    await waitFor(() => expect(setLinkViewVisible).toHaveBeenCalledWith('t1', true));
    expect(openLinkView).not.toHaveBeenCalled();
  });

  it('hides the tabs that are not showing', async () => {
    const { rerender } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());
    rerender({ t: TABS, a: 't2' });
    await waitFor(() => expect(setLinkViewVisible).toHaveBeenCalledWith('t1', false));
  });

  it('destroys the webview of a tab that was closed', async () => {
    const { rerender } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());
    rerender({ t: [TABS[1]], a: 't2' });
    await waitFor(() => expect(closeLinkView).toHaveBeenCalledWith('t1'));
  });
});

/**
 * Reported 2026-10-18 (#1068): closing a tab left its page on screen — the
 * chrome went, the content did not. A child webview is an OS surface, so
 * taking it off screen is its own step from releasing it.
 */
describe('tearing a tab down', () => {
  it('hides the surface before destroying it', async () => {
    const order: string[] = [];
    setLinkViewVisible.mockImplementation(async (id: string, visible: boolean) => {
      if (!visible) order.push(`hide:${id}`);
      return true;
    });
    closeLinkView.mockImplementation(async (id: string) => {
      order.push(`close:${id}`);
      return true;
    });

    const { rerender } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());
    rerender({ t: [TABS[1]], a: 't2' });

    await waitFor(() => expect(order).toContain('close:t1'));
    expect(order.indexOf('hide:t1')).toBeLessThan(order.indexOf('close:t1'));
  });

  it('hides and closes every tab when the pane unmounts', async () => {
    const { unmount } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(closeLinkView).toHaveBeenCalledWith('t1'));
    expect(setLinkViewVisible).toHaveBeenCalledWith('t1', false);
  });
});

/**
 * Swapping the task panel's dock side moves the pane without resizing it,
 * and a ResizeObserver never fires for a move — the surface stayed put and
 * the page was stranded on the old side (#1068).
 */
describe('resync', () => {
  it('repositions even when the rectangle looks unchanged', async () => {
    const { result } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());
    setLinkViewBounds.mockClear();

    result.current.resync();
    await waitFor(() => expect(setLinkViewBounds).toHaveBeenCalledWith('t1', expect.anything()));
  });
});

/**
 * The address bar points a tab somewhere else. The docking effect keys on
 * activeId alone — deliberately, so returning to a tab does not reload it —
 * so a URL change needs its own trigger, and a re-render must not fire it.
 */
describe('navigating from the address bar', () => {
  it('navigates when the active tab is pointed at a new URL', async () => {
    const { rerender } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalledTimes(1));

    rerender({ t: [{ id: 't1', url: 'https://moved.example' }, TABS[1]], a: 't1' });
    await waitFor(() =>
      expect(openLinkView).toHaveBeenCalledWith('t1', 'https://moved.example', expect.anything()),
    );
  });

  // Negative assertions: waiting on another mock would pass vacuously if it
  // is never called, so let the effects run and then look.
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

  it('does not re-navigate when nothing changed', async () => {
    const { rerender } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalledTimes(1));
    openLinkView.mockClear();
    rerender({ t: [...TABS], a: 't1' });
    await settle();
    expect(openLinkView).not.toHaveBeenCalled();
  });

  it('leaves a background tab alone when its URL changes', async () => {
    const { rerender } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalledTimes(1));
    openLinkView.mockClear();
    rerender({ t: [TABS[0], { id: 't2', url: 'https://other.example' }], a: 't1' });
    await settle();
    expect(openLinkView).not.toHaveBeenCalled();
  });
});

/**
 * Reported 2026-10-19 (#1076): with the task detail panel overlaid on the
 * right, pressing the tab's ✕ did not close the page — it moved to the
 * right. In split mode it closed correctly.
 *
 * That difference is the whole diagnosis. Closing the last tab changes the
 * measured panel width only in overlay mode (split is a constant 50vw), and
 * a width change calls `resync`, which defers a second pass to the next
 * frame. That pass used a captured activeId and ended in
 * `setLinkViewVisible(id, true)` — so it put the just-destroyed webview
 * back, at the pane's new rectangle.
 */
describe('a deferred resync must not resurrect a closed tab', () => {
  /** Let real animation frames and microtasks run. */
  const flushFrames = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))));

  /**
   * requestAnimationFrame under our control, so the deferred pass can be
   * made to land AFTER the teardown. Letting the real one fire takes
   * whichever order the clock happens to give, and the bug only shows in
   * one of them — a test that cannot choose proves nothing.
   */
  function captureFrames() {
    const queued: FrameRequestCallback[] = [];
    const realRaf = window.requestAnimationFrame;
    const realCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      queued.push(cb);
      return queued.length;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => {
      // Handles are 1-based indices into `queued`.
      if (handle >= 1 && handle <= queued.length) queued[handle - 1] = () => {};
    }) as typeof window.cancelAnimationFrame;
    return {
      run: () => act(() => queued.splice(0).forEach((cb) => cb(0))),
      restore: () => {
        window.requestAnimationFrame = realRaf;
        window.cancelAnimationFrame = realCancel;
      },
    };
  }

  it('does not show a tab again after it has been torn down', async () => {
    const frames = captureFrames();
    try {
      const { result, rerender } = renderWithBox(TABS, 't1');
      await waitFor(() => expect(openLinkView).toHaveBeenCalled());

      // The width change that only happens with an overlaid task panel.
      act(() => result.current.resync());
      // ...and the close that races it. The deferred pass is still queued.
      rerender({ t: [], a: null });
      await waitFor(() => expect(closeLinkView).toHaveBeenCalledWith('t1'));

      setLinkViewVisible.mockClear();
      await frames.run();
      expect(setLinkViewVisible).not.toHaveBeenCalledWith('t1', true);
    } finally {
      frames.restore();
    }
  });

  it('still repositions a tab that is genuinely open', async () => {
    const { result } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());
    setLinkViewBounds.mockClear();

    act(() => result.current.resync());
    await waitFor(() => expect(setLinkViewBounds).toHaveBeenCalledWith('t1', expect.anything()));
  });

  it('acts on the tab showing now, not the one captured when it was scheduled', async () => {
    const { result, rerender } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());

    act(() => result.current.resync());
    rerender({ t: TABS, a: 't2' });
    setLinkViewBounds.mockClear();
    await flushFrames();

    const forOldTab = setLinkViewBounds.mock.calls.filter((c) => c[0] === 't1');
    expect(forOldTab).toEqual([]);
  });
});

/**
 * A tab opened with "+" starts at Google. Everything the user does from
 * there happens inside the webview, so unless the webview says where it
 * went, the tab keeps claiming to be on the home page (#1078).
 */
describe('following the webview', () => {
  it('reports where the page went', async () => {
    const onPageChange = vi.fn();
    renderWithBox(TABS, 't1', undefined, onPageChange);
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());

    act(() => {
      pageChangedHandler?.({ tabId: 't1', url: 'https://one.example/search?q=rust' });
    });
    expect(onPageChange).toHaveBeenCalledWith('t1', {
      url: 'https://one.example/search?q=rust',
      title: undefined,
    });
  });

  it('reports a title that arrives on its own', async () => {
    const onPageChange = vi.fn();
    renderWithBox(TABS, 't1', undefined, onPageChange);
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());

    act(() => {
      pageChangedHandler?.({ tabId: 't1', title: 'rust - Google 検索' });
    });
    expect(onPageChange).toHaveBeenCalledWith('t1', {
      url: undefined,
      title: 'rust - Google 検索',
    });
  });

  // The hook navigates a tab whenever its stored URL stops matching what
  // was last shown. Folding the webview's own move back into the store
  // would otherwise look exactly like an address-bar edit and send the
  // page straight back to where it already is — a reload per navigation.
  it('does not navigate the webview back to the page it just reached', async () => {
    const onPageChange = vi.fn();
    const { rerender } = renderWithBox(TABS, 't1', undefined, onPageChange);
    await waitFor(() => expect(openLinkView).toHaveBeenCalledTimes(1));

    const moved = 'https://one.example/search?q=rust';
    act(() => {
      pageChangedHandler?.({ tabId: 't1', url: moved });
    });
    openLinkView.mockClear();

    // The store now holds what the webview reported, as the host applies it.
    // The navigation effect runs inside the rerender's act(), so a call
    // would already be recorded; the flush only settles its promise.
    rerender({ t: [{ id: 't1', url: moved }, TABS[1]], a: 't1' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(openLinkView).not.toHaveBeenCalled();
  });

  // Address-bar navigation still has to work: that URL was never shown.
  it('still navigates when the address bar points somewhere new', async () => {
    const { rerender } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalledTimes(1));

    openLinkView.mockClear();
    rerender({ t: [{ id: 't1', url: 'https://typed.example' }, TABS[1]], a: 't1' });
    await waitFor(() =>
      expect(openLinkView).toHaveBeenCalledWith('t1', 'https://typed.example', expect.anything()),
    );
  });

  it('ignores an event for a tab it never built', async () => {
    const onPageChange = vi.fn();
    renderWithBox(TABS, 't1', undefined, onPageChange);
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());

    act(() => {
      pageChangedHandler?.({ tabId: 'ghost', url: 'https://elsewhere.example' });
    });
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('stops listening when the pane goes away', async () => {
    const { unmount } = renderWithBox(TABS, 't1');
    await waitFor(() => expect(openLinkView).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(unlistenPageChanged).toHaveBeenCalled());
  });
});
