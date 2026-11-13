/**
 * LinkViewHost.browser.test
 *
 * How the single host serves both layouts (nav60 §3.1, §9 non-regression):
 * on /browser it portals the full screen into the page's slot and never
 * draws the pane (even when the pane is "open"); elsewhere the pane behaves
 * as before. Also pins Ctrl+B doing nothing on /browser, the internal link
 * setting refusing the app's own origins, overlay registration by the shared
 * dropdown and modal, and the reports listener turning `window.open` into a
 * tab and a long load into a band.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { useLinkViewStore } from '@/stores/link-view-store';
import { useLinkViewStatusStore } from '@/stores/link-view-status-store';
import { useWebviewOcclusionStore } from '@/stores/webview-occlusion-store';
import { useBrowserScreenSlotStore } from '../browser-screen-slot';
import { SLOW_LOAD_MS } from '../useLinkViewReports';
import { resetEmbedVerdicts } from '../useEmbedCheck';

let pathname = '/';
const handlers: Record<string, (e: { tabId: string; url: string; detail: string }) => void> = {};
const openSplit = vi.fn();
let tauri = false;

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/utils/tauri', () => ({
  isTauri: () => tauri,
  openExternalUrl: vi.fn(),
  openExternalUrlInSplitView: (url: string) => openSplit(url),
}));
vi.mock('@/utils/link-view-events', () => ({
  onLinkViewEvent: async (
    name: string,
    handler: (e: { tabId: string; url: string; detail: string }) => void,
  ) => {
    handlers[name] = handler;
    return () => {};
  },
}));
vi.mock('@/components/ui/dialog/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => async () => true,
}));
vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock('../../useTaskPanelWidth', () => ({ useTaskPanelWidthVw: () => 0 }));

import LinkViewHost from '../../LinkViewHost';
import { toggleBrowserPane } from '@/components/common/KeyboardShortcuts';
import { openExternalLink } from '@/utils/external-links';
import { LINK_OPEN_MODE_KEY } from '@/utils/link-view';
import DropdownMenu from '@/components/ui/dropdown/DropdownMenu';
import { Modal } from '@/components/ui/modal/Modal';

/** The /browser page's slot, as the page renders it. */
function mountSlot(): HTMLDivElement {
  const slot = document.createElement('div');
  slot.setAttribute('data-browser-screen-slot', '');
  document.body.appendChild(slot);
  act(() => useBrowserScreenSlotStore.getState().setSlot(slot));
  return slot;
}

beforeEach(() => {
  pathname = '/';
  tauri = false;
  openSplit.mockReset();
  localStorage.clear();
  useLinkViewStore.setState({ tabs: [], activeId: null, isOpen: false, view: 'page' });
  useLinkViewStatusStore.setState({ bands: {}, loadingSince: {}, webviewEpoch: 0 });
  useWebviewOcclusionStore.setState({ occluders: [] });
  useBrowserScreenSlotStore.setState({ slot: null });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ result: 'embeddable' }))),
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('layouts', () => {
  it('portals the screen into the /browser slot and draws no pane there', () => {
    pathname = '/browser';
    useLinkViewStore.getState().openLink('https://example.com/');
    expect(useLinkViewStore.getState().isOpen).toBe(true);
    const slot = mountSlot();
    render(<LinkViewHost />);
    expect(slot.querySelector('[data-testid="browser-screen"]')).toBeTruthy();
    expect(document.querySelectorAll('[data-testid="browser-screen"]')).toHaveLength(1);
    // The pane's ✕ (its close button) is not rendered on /browser.
    expect(screen.queryByTitle('close')).toBeNull();
  });

  it('keeps the docked pane everywhere else', () => {
    useLinkViewStore.getState().openLink('https://example.com/');
    render(<LinkViewHost />);
    expect(screen.queryByTestId('browser-screen')).toBeNull();
    expect(screen.getByTitle('close')).toBeTruthy();
  });

  it('renders nothing before the slot exists', () => {
    pathname = '/browser';
    const { container } = render(<LinkViewHost />);
    expect(container.innerHTML).toBe('');
  });
});

describe('Ctrl+B', () => {
  it('toggles the pane elsewhere', () => {
    toggleBrowserPane('/kanban');
    expect(useLinkViewStore.getState().isOpen).toBe(true);
    toggleBrowserPane('/kanban');
    expect(useLinkViewStore.getState().isOpen).toBe(false);
  });

  it('does nothing on /browser', () => {
    toggleBrowserPane('/browser');
    expect(useLinkViewStore.getState().isOpen).toBe(false);
  });
});

describe('the "internal" link setting', () => {
  it('opens ordinary links in the pane, and the app origin in the browser instead', () => {
    tauri = true;
    localStorage.setItem(LINK_OPEN_MODE_KEY, 'internal');
    openExternalLink('https://example.com/a');
    expect(useLinkViewStore.getState().tabs.map((t) => t.url)).toEqual(['https://example.com/a']);
    openExternalLink('http://127.0.0.1:3000/kanban');
    expect(useLinkViewStore.getState().tabs).toHaveLength(1);
    expect(openSplit).toHaveBeenCalledWith('http://127.0.0.1:3000/kanban');
  });

  it('still opens everything externally under "external"', () => {
    tauri = true;
    openExternalLink('https://example.com/a');
    expect(useLinkViewStore.getState().tabs).toEqual([]);
    expect(openSplit).toHaveBeenCalledWith('https://example.com/a');
  });
});

describe('overlay registration', () => {
  it('counts an open dropdown and an open modal, and releases them', () => {
    const { rerender } = render(
      <>
        <DropdownMenu items={[{ label: 'x', onClick: () => {} }]} triggerLabel="menu" />
        <Modal open onClose={() => {}} title="t">
          body
        </Modal>
      </>,
    );
    expect(useWebviewOcclusionStore.getState().occluders).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'menu' }));
    expect(useWebviewOcclusionStore.getState().occluders).toHaveLength(2);
    rerender(
      <>
        <DropdownMenu items={[{ label: 'x', onClick: () => {} }]} triggerLabel="menu" />
        <Modal open={false} onClose={() => {}} title="t">
          body
        </Modal>
      </>,
    );
    expect(useWebviewOcclusionStore.getState().occluders).toHaveLength(1);
  });
});

describe('webview reports', () => {
  it('opens a checked window.open target as a new tab, and refuses the app origin', () => {
    render(<LinkViewHost />);
    act(() => handlers.newWindow({ tabId: 't0', url: 'https://popup.example/', detail: 'tab' }));
    expect(useLinkViewStore.getState().tabs.map((t) => t.url)).toEqual(['https://popup.example/']);
    act(() => handlers.newWindow({ tabId: 't0', url: 'http://localhost:3001/', detail: 'tab' }));
    expect(useLinkViewStore.getState().tabs).toHaveLength(1);
    expect(useLinkViewStatusStore.getState().bands.t0?.kind).toBe('new-window-blocked');
  });

  it('raises the slow-load band after 20 s, and clears it when loading finishes', () => {
    vi.useFakeTimers();
    render(<LinkViewHost />);
    act(() => handlers.loadState({ tabId: 't1', url: 'https://slow.example/', detail: 'started' }));
    act(() => vi.advanceTimersByTime(SLOW_LOAD_MS - 1));
    expect(useLinkViewStatusStore.getState().bands.t1).toBeUndefined();
    act(() => vi.advanceTimersByTime(1));
    expect(useLinkViewStatusStore.getState().bands.t1?.kind).toBe('slow-load');
    act(() =>
      handlers.loadState({ tabId: 't1', url: 'https://slow.example/', detail: 'finished' }),
    );
    expect(useLinkViewStatusStore.getState().bands.t1).toBeUndefined();
  });

  it('shows a band for a blocked download', () => {
    render(<LinkViewHost />);
    act(() =>
      handlers.downloadBlocked({ tabId: 't2', url: 'blob:https://x/1', detail: 'download' }),
    );
    expect(useLinkViewStatusStore.getState().bands.t2?.kind).toBe('download-blocked');
  });
});

describe('desktop first render', () => {
  it('never builds a web iframe or asks the embed check on the desktop', () => {
    tauri = true;
    pathname = '/browser';
    // Earlier tests cached example.com's verdict; without a reset a web
    // render would not fetch and this test could not fail.
    resetEmbedVerdicts();
    useLinkViewStore.getState().openLink('https://example.com/');
    mountSlot();
    render(<LinkViewHost />);
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByTestId('browser-surface')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
