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

vi.mock('@/utils/link-view', () => ({
  openLinkView: (...args: unknown[]) => openLinkView(...args),
  setLinkViewBounds: (...args: unknown[]) => setLinkViewBounds(...args),
  setLinkViewVisible: (...args: unknown[]) => setLinkViewVisible(...args),
  closeLinkView: (...args: unknown[]) => closeLinkView(...args),
  linkViewHistory: vi.fn().mockResolvedValue(true),
}));

import { useLinkView } from './useLinkView';

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
) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 600 }) as DOMRect;
  document.body.appendChild(el);

  return renderHook(
    ({ t, a }: { t: LinkTab[]; a: string | null }) => {
      const view = useLinkView(t, a, onUnavailable);
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
