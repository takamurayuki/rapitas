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
import { renderHook, waitFor } from '@testing-library/react';
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

describe('useLinkView', () => {
  beforeEach(() => {
    openLinkView.mockReset().mockResolvedValue(true);
    setLinkViewVisible.mockReset().mockResolvedValue(true);
    setLinkViewBounds.mockReset().mockResolvedValue(true);
    closeLinkView.mockReset().mockResolvedValue(true);
    document.body.innerHTML = '';
  });

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
