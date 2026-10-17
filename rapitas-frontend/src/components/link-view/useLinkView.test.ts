/**
 * useLinkView.test
 *
 * The case worth pinning down is the one a user hits first: a desktop build
 * made before tauri's `unstable` feature existed has no link-view command, so
 * the dock fails. Without a fallback the setting is switchable, the link is
 * clicked, and nothing at all happens — indistinguishable from a broken link.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const openLinkView = vi.fn();

vi.mock('@/utils/link-view', () => ({
  openLinkView: (url: string, bounds: unknown) => openLinkView(url, bounds),
  setLinkViewBounds: vi.fn().mockResolvedValue(true),
  setLinkViewVisible: vi.fn().mockResolvedValue(true),
  closeLinkView: vi.fn().mockResolvedValue(true),
  linkViewHistory: vi.fn().mockResolvedValue(true),
}));

import { useLinkView } from './useLinkView';

/** Give the hook a placeholder with a real box, as the pane does. */
function attachPlaceholder(ref: React.RefObject<HTMLDivElement | null>) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 600 }) as DOMRect;
  document.body.appendChild(el);
  ref.current = el;
}

describe('useLinkView', () => {
  beforeEach(() => {
    openLinkView.mockReset();
    document.body.innerHTML = '';
  });

  it('docks the URL at the placeholder box', async () => {
    openLinkView.mockResolvedValue(true);
    const { result } = renderHook(() => useLinkView());
    attachPlaceholder(result.current.placeholderRef);

    act(() => result.current.open('https://example.com'));

    await waitFor(() =>
      expect(openLinkView).toHaveBeenCalledWith('https://example.com', {
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
    const { result } = renderHook(() => useLinkView(onUnavailable));
    attachPlaceholder(result.current.placeholderRef);

    act(() => result.current.open('https://example.com'));

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith('https://example.com'));
  });

  it('does not hand back a URL that docked fine', async () => {
    openLinkView.mockResolvedValue(true);
    const onUnavailable = vi.fn();
    const { result } = renderHook(() => useLinkView(onUnavailable));
    attachPlaceholder(result.current.placeholderRef);

    act(() => result.current.open('https://example.com'));

    await waitFor(() => expect(openLinkView).toHaveBeenCalled());
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
