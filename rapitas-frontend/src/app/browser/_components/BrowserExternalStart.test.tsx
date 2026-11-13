/**
 * BrowserExternalStart.test
 *
 * The /browser screen's external-only face: the address bar and the saved
 * pages both open in the external browser whatever "how links open" says,
 * and nothing in-app (pane, webview, iframe) is created.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserExternalStart } from './BrowserExternalStart';
import { useLinkViewStore } from '@/stores/link-view-store';
import { useLinkLibraryStore } from '@/stores/link-library-store';
import { LINK_OPEN_MODE_KEY } from '@/utils/link-view';

const openSplit = vi.fn();
const openLinkView = vi.fn();

vi.mock('@/utils/tauri', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Pretend to be the desktop app so the `internal` setting is live.
  isTauri: () => true,
  openExternalUrlInSplitView: (url: string) => openSplit(url),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args: unknown) => openLinkView(cmd, args),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const type = (value: string) => {
  const input = screen.getByRole('textbox', { name: 'addressLabel' });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

describe.each(['external', 'internal'] as const)('BrowserExternalStart (mode=%s)', (mode) => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    if (mode === 'internal') localStorage.setItem(LINK_OPEN_MODE_KEY, 'internal');
    useLinkViewStore.setState({ isOpen: false, tabs: [], activeId: null, view: 'page' });
    useLinkLibraryStore.setState({
      favourites: [
        { id: 'f1', url: 'https://example.com/saved', title: 'Saved', favicon: '', groupId: null },
      ],
      groups: [],
    });
  });

  it('opens a typed address externally, adding the scheme', () => {
    render(<BrowserExternalStart />);
    type('example.com/docs');
    expect(openSplit).toHaveBeenCalledWith('https://example.com/docs');
    expect(useLinkViewStore.getState().isOpen).toBe(false);
    expect(useLinkViewStore.getState().tabs).toEqual([]);
    expect(openLinkView).not.toHaveBeenCalled();
  });

  it('opens a saved page externally', () => {
    render(<BrowserExternalStart />);
    fireEvent.click(screen.getByText('Saved'));
    expect(openSplit).toHaveBeenCalledWith('https://example.com/saved');
    expect(useLinkViewStore.getState().isOpen).toBe(false);
    expect(openLinkView).not.toHaveBeenCalled();
  });

  it('refuses non-web schemes', () => {
    render(<BrowserExternalStart />);
    type('javascript:alert(1)');
    type('file:///etc/hosts');
    expect(openSplit).not.toHaveBeenCalled();
  });

  it('says where pages open, and draws no frame or close button', () => {
    const { container } = render(<BrowserExternalStart />);
    expect(screen.getByText('opensExternally')).toBeTruthy();
    expect(container.querySelector('iframe')).toBeNull();
    expect(screen.queryByTitle('close')).toBeNull();
  });
});
