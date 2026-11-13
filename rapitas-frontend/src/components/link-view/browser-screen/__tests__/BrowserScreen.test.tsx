/**
 * BrowserScreen.test
 *
 * The /browser screen (nav60 §1.2, §3.2, §1.3). Web: a page gets a
 * sandboxed iframe only after the embed check, a refused page gets a card
 * instead, the "open externally" rescue never goes away (not even after
 * `load`), tab switches keep frames while address changes rebuild them, and
 * the shared-history caveat offers the previous app screen. Desktop: page
 * back/forward and a bare surface for the webview, no iframe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { useLinkViewStore } from '@/stores/link-view-store';
import { useLinkLibraryStore } from '@/stores/link-library-store';
import { useLinkViewStatusStore } from '@/stores/link-view-status-store';
import { useNavigationHistoryStore } from '@/components/header/history/navigation-history-store';
import { BrowserScreen } from '../BrowserScreen';
import { FRAME_ALLOW, FRAME_SANDBOX } from '../BrowserWebFrames';
import { resetEmbedVerdicts } from '../useEmbedCheck';

const push = vi.fn();
const openExternalUrl = vi.fn();
let verdict: 'embeddable' | 'refused' | 'unknown' = 'embeddable';
const embedChecks: unknown[] = [];

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://127.0.0.1:3001' }));
vi.mock('@/utils/tauri', () => ({
  isTauri: () => false,
  openExternalUrl: (url: string) => openExternalUrl(url),
}));
vi.mock('@/components/ui/dialog/ConfirmDialogProvider', () => ({
  useConfirmDialog: () => async () => true,
}));
vi.mock('@/components/ui/toast/ToastContainer', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const typeAddress = (value: string) => {
  const input = screen.getByRole('textbox', { name: 'addressLabel' });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

beforeEach(() => {
  push.mockReset();
  openExternalUrl.mockReset();
  verdict = 'embeddable';
  embedChecks.length = 0;
  resetEmbedVerdicts();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      embedChecks.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ result: verdict }));
    }),
  );
  useLinkViewStore.setState({ tabs: [], activeId: null, isOpen: false, view: 'page' });
  useLinkLibraryStore.setState({ favourites: [], groups: [] });
  useLinkViewStatusStore.setState({ bands: {}, loadingSince: {}, webviewEpoch: 0 });
  useNavigationHistoryStore.setState({ entries: ['/kanban', '/browser'], index: 1 });
});

const renderWeb = () =>
  render(<BrowserScreen isDesktop={false} surfaceRef={() => {}} onHistory={vi.fn()} />);

describe('start page (no tab)', () => {
  it('shows the favourites, focuses the address bar and loads nothing', () => {
    const { container } = renderWeb();
    expect(screen.getByTestId('browser-start')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'addressLabel' }));
    expect(container.querySelector('iframe')).toBeNull();
    expect(embedChecks).toHaveLength(0);
  });

  it('refuses the app or backend origin without making a tab', () => {
    renderWeb();
    typeAddress('http://127.0.0.1:3000/');
    typeAddress('localhost:3001');
    expect(useLinkViewStore.getState().tabs).toEqual([]);
    expect(screen.getByRole('status').textContent).toBe('bandNavigationBlocked');
  });

  it('searches a phrase that is not a URL (Q4)', () => {
    renderWeb();
    typeAddress('rust ownership');
    expect(useLinkViewStore.getState().tabs[0].url).toBe(
      'https://www.google.com/search?q=rust%20ownership',
    );
  });
});

describe('web frames', () => {
  it('checks first, then frames the page sandboxed with features denied', async () => {
    renderWeb();
    typeAddress('example.com');
    const frame = await screen.findByTestId('browser-web-frame');
    expect(embedChecks[0]).toEqual({ url: 'https://example.com/', origin: window.location.origin });
    expect(frame.getAttribute('sandbox')).toBe(FRAME_SANDBOX);
    expect(frame.getAttribute('sandbox')).not.toMatch(/top-navigation|escape-sandbox|downloads/);
    expect(frame.getAttribute('allow')).toBe(FRAME_ALLOW);
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('keeps the rescue line and the external button after load', async () => {
    renderWeb();
    typeAddress('example.com');
    const frame = await screen.findByTestId('browser-web-frame');
    fireEvent.load(frame);
    const rescue = screen.getByTestId('browser-rescue-notice');
    expect(rescue.textContent).toContain('rescueNotice');
    fireEvent.click(within(rescue).getByText('openExternally'));
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com/');
    expect(screen.getByTestId('browser-open-external')).toBeTruthy();
  });

  it('shows a card instead of a frame for a refused page', async () => {
    verdict = 'refused';
    const { container } = renderWeb();
    typeAddress('github.com');
    const card = await screen.findByTestId('browser-refused-card');
    expect(container.querySelector('iframe')).toBeNull();
    fireEvent.click(within(card).getByText('openExternally'));
    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/');
  });

  it('says so when the verdict is unknown, and still frames the page', async () => {
    verdict = 'unknown';
    renderWeb();
    typeAddress('example.org');
    await screen.findByTestId('browser-web-frame');
    expect(screen.getByTestId('browser-rescue-notice').textContent).toContain('unknownNotice');
  });

  it('keeps each frame across tab switches but rebuilds it for a new address', async () => {
    renderWeb();
    typeAddress('one.example');
    await screen.findByTestId('browser-web-frame');
    act(() => useLinkViewStore.getState().openLink('https://two.example/'));
    await waitFor(() => expect(screen.getAllByTestId('browser-web-frame')).toHaveLength(2));
    const [first] = screen.getAllByTestId('browser-web-frame');
    expect(first.hidden).toBe(true);

    act(() => useLinkViewStore.getState().activateTab(useLinkViewStore.getState().tabs[0].id));
    expect(screen.getAllByTestId('browser-web-frame')[0]).toBe(first);
    expect(first.hidden).toBe(false);

    typeAddress('three.example');
    await waitFor(() =>
      expect(screen.getAllByTestId('browser-web-frame')[0].getAttribute('src')).toBe(
        'https://three.example/',
      ),
    );
    expect(screen.getAllByTestId('browser-web-frame')[0]).not.toBe(first);
  });
});

describe('favourites → an existing tab', () => {
  const tabButton = (host: string) =>
    screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('title')?.includes(`https://${host}/`)) as HTMLElement;

  it('returns to the page of the tab picked on the web', async () => {
    renderWeb();
    typeAddress('one.example');
    act(() => useLinkViewStore.getState().openLink('https://two.example/'));
    await waitFor(() => expect(screen.getAllByTestId('browser-web-frame')).toHaveLength(2));

    fireEvent.click(screen.getByRole('button', { name: 'favourites' }));
    expect(screen.getByTestId('browser-start')).toBeTruthy();

    fireEvent.click(tabButton('one.example'));
    expect(screen.queryByTestId('browser-start')).toBeNull();
    expect(useLinkViewStore.getState().view).toBe('page');
    const [first, second] = screen.getAllByTestId('browser-web-frame');
    expect(first.hidden).toBe(false);
    expect(second.hidden).toBe(true);
  });

  it('brings the surface back for the picked tab on the desktop', () => {
    act(() => {
      useLinkViewStore.getState().openLink('https://one.example/');
      useLinkViewStore.getState().openLink('https://two.example/');
      useLinkViewStore.getState().showLibrary();
    });
    render(<BrowserScreen isDesktop surfaceRef={() => {}} onHistory={vi.fn()} />);
    expect(screen.queryByTestId('browser-surface')).toBeNull();

    fireEvent.click(tabButton('one.example'));
    expect(screen.getByTestId('browser-surface')).toBeTruthy();
    expect(useLinkViewStore.getState().activeId).toBe(useLinkViewStore.getState().tabs[0].id);
  });
});

describe('shared history caveat (Q10)', () => {
  it('is always shown on the web and returns to the screen before /browser', async () => {
    renderWeb();
    typeAddress('example.com');
    await screen.findByTestId('browser-web-frame');
    const notice = screen.getByTestId('browser-history-notice');
    fireEvent.click(within(notice).getByText('previousScreen'));
    expect(push).toHaveBeenCalledWith('/kanban');
  });

  it('falls back to home when there is no earlier screen', async () => {
    useNavigationHistoryStore.setState({ entries: ['/browser'], index: 0 });
    renderWeb();
    typeAddress('example.com');
    await screen.findByTestId('browser-web-frame');
    fireEvent.click(screen.getByText('previousScreen'));
    expect(push).toHaveBeenCalledWith('/');
  });

  it('hides page back/forward on the web', () => {
    renderWeb();
    expect(screen.queryByRole('button', { name: 'back' })).toBeNull();
  });
});

describe('desktop', () => {
  it('offers page back/forward and draws a bare surface, never an iframe', () => {
    const onHistory = vi.fn();
    useLinkViewStore.getState().openLink('https://example.com/');
    const surfaceRef = vi.fn();
    const { container } = render(
      <BrowserScreen isDesktop surfaceRef={surfaceRef} onHistory={onHistory} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'back' }));
    fireEvent.click(screen.getByRole('button', { name: 'forward' }));
    expect(onHistory.mock.calls).toEqual([['back'], ['forward']]);
    expect(container.querySelector('iframe')).toBeNull();
    expect(surfaceRef).toHaveBeenCalledWith(screen.getByTestId('browser-surface'));
    expect(screen.queryByTestId('browser-history-notice')).toBeNull();
    expect(embedChecks).toHaveLength(0);
  });

  it('shows a band for a refused navigation as plain text', () => {
    useLinkViewStore.getState().openLink('https://example.com/');
    const id = useLinkViewStore.getState().activeId!;
    useLinkViewStatusStore
      .getState()
      .showBand(id, { kind: 'navigation-blocked', url: '<img src=x onerror=alert(1)>' });
    render(<BrowserScreen isDesktop surfaceRef={() => {}} onHistory={vi.fn()} />);
    const band = screen.getByTestId('link-band');
    expect(band.getAttribute('data-band-kind')).toBe('navigation-blocked');
    // The page-supplied URL is an attribute string, never markup.
    expect(band.querySelector('img')).toBeNull();
    expect(band.querySelector('[title]')?.getAttribute('title')).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});
