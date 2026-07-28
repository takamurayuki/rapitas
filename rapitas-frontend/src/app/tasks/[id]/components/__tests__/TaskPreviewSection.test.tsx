/**
 * TaskPreviewSection
 *
 * Idle by default; restores an already-running session on mount; starting
 * transitions to a polling screenshot view; a failed start shows the error;
 * stop tears the session down and returns to idle.
 */
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import TaskPreviewSection from '../TaskPreviewSection';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) };
}

function blobResponse(bytes: number[]) {
  return { ok: true, blob: () => Promise.resolve(new Blob([new Uint8Array(bytes)])) };
}

/** Flushes pending promise microtasks without touching fake timers. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe('TaskPreviewSection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // createObjectURL/revokeObjectURL aren't implemented in jsdom.
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows the idle start button when no session is running', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ active: false })));
    render(<TaskPreviewSection taskId={1} />);
    await flush();
    expect(screen.getByText('start')).toBeInTheDocument();
  });

  it('shows a "checking" placeholder before the restore-on-mount status check resolves, never the idle Start button', async () => {
    // Regression: the initial state used to be 'idle', so on a page reload
    // of an already-running preview, the Start button flashed on screen
    // first and only got replaced by the active view once the async status
    // check resolved a moment later.
    let resolveStatus: (v: unknown) => void = () => {};
    const statusPromise = new Promise((res) => {
      resolveStatus = res;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/status')) return statusPromise;
        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<TaskPreviewSection taskId={1} />);

    // Status check hasn't resolved yet — must show "checking", not "start".
    expect(screen.getByText('checking')).toBeInTheDocument();
    expect(screen.queryByText('start')).not.toBeInTheDocument();

    await act(async () => {
      resolveStatus(jsonResponse({ active: false }));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(screen.getByText('start')).toBeInTheDocument();
    expect(screen.queryByText('checking')).not.toBeInTheDocument();
  });

  it('restores the active view when a session is already running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/status')) {
          return Promise.resolve(jsonResponse({ active: true, url: 'http://localhost:5173' }));
        }
        if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
        return Promise.resolve(jsonResponse({}));
      }),
    );
    render(<TaskPreviewSection taskId={1} />);
    await flush();
    expect(screen.getByText('stop')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:5173')).toBeInTheDocument();
  });

  it('unmounting an active preview does NOT stop it — the session must survive reload/navigation', async () => {
    // Regression: an earlier "stop on unmount" effect fired on every
    // unmount (including a page reload's remount), which killed the very
    // session the restore-on-mount effect above is meant to find again —
    // so returning to the task always showed the idle Start button instead
    // of Stop, even though the preview was still genuinely running.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/status')) {
        return Promise.resolve(jsonResponse({ active: true, url: 'http://localhost:5173' }));
      }
      if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const { unmount } = render(<TaskPreviewSection taskId={1} />);
    await flush();
    expect(screen.getByText('stop')).toBeInTheDocument();

    fetchMock.mockClear();
    unmount();

    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/stop',
      expect.anything(),
    );
  });

  it('starting a preview transitions to the active view and fetches a screenshot', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/status')) return Promise.resolve(jsonResponse({ active: false }));
      if (url.includes('/start') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ success: true, url: 'http://localhost:5173' }));
      }
      if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();
    expect(screen.getByText('start')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('start'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(screen.getByText('stop')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/start',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows an error message when starting fails', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/status')) return Promise.resolve(jsonResponse({ active: false }));
      if (url.includes('/start') && init?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({ success: false, reason: 'not_configured', error: 'not configured' }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByText('start'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(screen.getByText('not configured')).toBeInTheDocument();
    // Stays on the start button — no active session was created.
    expect(screen.getByText('start')).toBeInTheDocument();
  });

  it('lets the user fix a missing preview config from the settings modal, then retry from the header', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/status')) return Promise.resolve(jsonResponse({ active: false }));
      if (url.endsWith('/preview/start') && init?.method === 'POST') {
        // First attempt (header button) fails as unconfigured; after the
        // user saves a config from the modal, retrying from the header (the
        // only Start control — the modal itself has none) succeeds.
        return fetchMock.mock.calls.filter((c) => c[0] === url).length === 1
          ? Promise.resolve(
              jsonResponse({ success: false, reason: 'not_configured', error: 'not configured' }),
            )
          : Promise.resolve(jsonResponse({ success: true, url: 'http://localhost:5173' }));
      }
      if (url.endsWith('/preview/runtime-config') && (!init || init.method === undefined)) {
        return Promise.resolve(jsonResponse({ hasTheme: true, runtimeConfigJson: null }));
      }
      if (url.endsWith('/preview/runtime-config') && init?.method === 'PUT') {
        return Promise.resolve(jsonResponse({ success: true }));
      }
      if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByText('start'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(screen.getByText('not configured')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('configureRuntime'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('start'), {
      target: { value: 'npm run dev -- -p {port}' },
    });
    fireEvent.change(within(dialog).getByLabelText('url'), {
      target: { value: 'http://localhost:{port}' },
    });

    await act(async () => {
      fireEvent.click(within(dialog).getByText('save'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/runtime-config',
      expect.objectContaining({ method: 'PUT' }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'start' }));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(screen.getByText('http://localhost:5173')).toBeInTheDocument();
  });

  it('opens the settings modal from the persistent header gear icon even when idle (no error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/status')) return Promise.resolve(jsonResponse({ active: false }));
        if (url.endsWith('/preview/runtime-config')) {
          return Promise.resolve(
            jsonResponse({
              hasTheme: true,
              runtimeConfigJson: JSON.stringify({
                start: 'npm run dev',
                url: 'http://localhost:{port}',
              }),
            }),
          );
        }
        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByText('settings'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('start')).toHaveValue('npm run dev');
  });

  it('does not show a LIVE/URL status line or a Stop button inside the settings modal while active', async () => {
    // The modal used to duplicate the header's LIVE badge/URL and offer its
    // own Stop button — both removed as redundant with the main panel.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/status')) {
          return Promise.resolve(jsonResponse({ active: true, url: 'http://localhost:5173' }));
        }
        if (url.endsWith('/preview/runtime-config')) {
          return Promise.resolve(jsonResponse({ hasTheme: true, runtimeConfigJson: null }));
        }
        if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByText('settings'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByText('liveBadge')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/http:\/\/localhost:5173/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('stop')).not.toBeInTheDocument();
  });

  it('closes the settings modal after a successful save', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/status')) return Promise.resolve(jsonResponse({ active: false }));
        if (url.endsWith('/preview/runtime-config') && (!init || init.method === undefined)) {
          return Promise.resolve(jsonResponse({ hasTheme: true, runtimeConfigJson: null }));
        }
        if (url.endsWith('/preview/runtime-config') && init?.method === 'PUT') {
          return Promise.resolve(jsonResponse({ success: true }));
        }
        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByText('settings'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByText('save'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the settings modal open with an error when saving fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/status')) return Promise.resolve(jsonResponse({ active: false }));
        if (url.endsWith('/preview/runtime-config') && (!init || init.method === undefined)) {
          return Promise.resolve(jsonResponse({ hasTheme: true, runtimeConfigJson: null }));
        }
        if (url.endsWith('/preview/runtime-config') && init?.method === 'PUT') {
          return Promise.resolve(jsonResponse({ success: false, error: 'invalid JSON' }));
        }
        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByText('settings'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByText('save'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('invalid JSON')).toBeInTheDocument();
  });

  it('picking "normal display" in the settings modal makes the header Start button send headless:false', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/status')) return Promise.resolve(jsonResponse({ active: false }));
      if (url.endsWith('/preview/runtime-config')) {
        return Promise.resolve(
          jsonResponse({
            hasTheme: true,
            runtimeConfigJson: JSON.stringify({
              start: 'npm run dev',
              url: 'http://localhost:{port}',
            }),
          }),
        );
      }
      if (url.endsWith('/preview/start') && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ success: true, url: 'http://localhost:5173' }));
      }
      if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByText('settings'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('displayModeNormal'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'start' }));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/start',
      expect.objectContaining({ body: JSON.stringify({ headless: false }) }),
    );
  });

  it('shows a Stop button while starting (not just once active) and stopping mid-start returns to idle', async () => {
    // The start request never resolves in this test — starting a real dev
    // server + browser takes tens of seconds, and the user must be able to
    // cancel a slow/stuck attempt instead of waiting it out.
    let resolveStart: (v: unknown) => void = () => {};
    const startPromise = new Promise((res) => {
      resolveStart = res;
    });
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/status')) return Promise.resolve(jsonResponse({ active: false }));
      if (url.includes('/start') && init?.method === 'POST') return startPromise;
      if (url.includes('/stop')) return Promise.resolve(jsonResponse({ success: true }));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    await act(async () => {
      fireEvent.click(screen.getByText('start'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    // Still "starting" (the start fetch hasn't resolved) — Stop must already
    // be clickable, not just once the session becomes active.
    expect(screen.getByText('stop')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('stop'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(screen.getByText('start')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/stop',
      expect.objectContaining({ method: 'POST' }),
    );

    // The abandoned start request finally resolves — its stale success must
    // NOT resurrect the active view after the user already stopped it.
    await act(async () => {
      resolveStart(jsonResponse({ success: true, url: 'http://localhost:5173' }));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(screen.getByText('start')).toBeInTheDocument();
    expect(screen.queryByText('http://localhost:5173')).not.toBeInTheDocument();
  });

  it('stopping an active preview calls the stop endpoint and returns to idle', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/status')) {
        return Promise.resolve(jsonResponse({ active: true, url: 'http://localhost:5173' }));
      }
      if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
      if (url.includes('/stop')) return Promise.resolve(jsonResponse({ success: true }));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();
    expect(screen.getByText('stop')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('stop'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(screen.getByText('start')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/stop',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('shows a transitional "stopping" state with the last frame still visible, not an abrupt cut to idle', async () => {
    // Regression: stopping used to jump straight from the live screenshot to
    // the idle placeholder the instant the request resolved — the user
    // reported this reads as the screen having "reverted on its own" rather
    // than a deliberate stop they just triggered.
    let resolveStop: (v: unknown) => void = () => {};
    const stopPromise = new Promise((res) => {
      resolveStop = res;
    });
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/status')) {
        return Promise.resolve(jsonResponse({ active: true, url: 'http://localhost:5173' }));
      }
      if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
      if (url.includes('/stop')) return stopPromise;
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();
    expect(screen.getByText('stop')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('stop'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    // Mid-stop: still showing the last screenshot's URL caption (not gone),
    // the Stop button is now disabled/relabeled, and the idle placeholder
    // has NOT appeared yet.
    expect(screen.getByText('stopping')).toBeInTheDocument();
    expect(screen.getByText('stoppingHint')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:5173')).toBeInTheDocument();
    expect(screen.queryByText('idleHint')).not.toBeInTheDocument();

    await act(async () => {
      resolveStop(jsonResponse({ success: true }));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(screen.getByText('start')).toBeInTheDocument();
    expect(screen.queryByText('http://localhost:5173')).not.toBeInTheDocument();
  });

  it('a failed stop request shows an error instead of silently claiming success', async () => {
    // Regression: handleStop used to set phase: 'idle' unconditionally
    // BEFORE the request even fired, and swallow any failure in a bare
    // catch — a blocked/failed stop (e.g. a CSRF guard rejection, or any
    // network error) left the backend session running while the UI
    // reported "stopped" with no indication anything went wrong.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/status')) {
        return Promise.resolve(jsonResponse({ active: true, url: 'http://localhost:5173' }));
      }
      if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
      if (url.includes('/stop')) return Promise.resolve(jsonResponse({ error: 'blocked' }, false));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();
    expect(screen.getByText('stop')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('stop'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(screen.getByText('stopFailed')).toBeInTheDocument();
  });

  it('clicking the screenshot relays a scaled click and refetches the screenshot', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/status')) {
        return Promise.resolve(jsonResponse({ active: true, url: 'http://localhost:5173' }));
      }
      if (url.includes('/interact')) return Promise.resolve(jsonResponse({ success: true }));
      if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    const img = screen.getByAltText('screenshotAlt');
    // 640x400 displayed size against the fixed 1280x800 remote viewport is a
    // clean 2x scale, so a click at (100,50) on-screen should relay (200,100).
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 640,
      height: 400,
      right: 640,
      bottom: 400,
      toJSON: () => ({}),
    });

    fetchMock.mockClear();
    await act(async () => {
      fireEvent.click(img, { clientX: 100, clientY: 50 });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/interact',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'click', x: 200, y: 100 }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith('http://test:3001/tasks/1/preview/screenshot');
  });

  it('clicking a native <select> shows our own dropdown instead of relaying a click', async () => {
    // Regression: a native <select>'s dropdown is drawn by the OS/browser
    // chrome, not the page, so it never appears in the screenshot and a raw
    // click can't pick an option in it — clicking one used to silently do
    // nothing useful.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/status')) {
        return Promise.resolve(jsonResponse({ active: true, url: 'http://localhost:5173' }));
      }
      if (url.includes('/inspect')) {
        return Promise.resolve(
          jsonResponse({
            success: true,
            isSelect: true,
            value: 'a',
            options: [
              { value: 'a', label: 'Option A', selected: true },
              { value: 'b', label: 'Option B', selected: false },
            ],
          }),
        );
      }
      if (url.includes('/interact')) return Promise.resolve(jsonResponse({ success: true }));
      if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    const img = screen.getByAltText('screenshotAlt');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 640,
      height: 400,
      right: 640,
      bottom: 400,
      toJSON: () => ({}),
    });

    fetchMock.mockClear();
    await act(async () => {
      fireEvent.click(img, { clientX: 100, clientY: 50 });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    // The overlay is shown with both options, and NO click interaction was
    // relayed (only the inspect call happened).
    expect(screen.getByText('Option A')).toBeInTheDocument();
    expect(screen.getByText('Option B')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/inspect',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ x: 200, y: 100 }) }),
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/interact',
      expect.anything(),
    );

    // Choosing an option relays a 'select' action and closes the overlay.
    fetchMock.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByText('Option B'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/interact',
      expect.objectContaining({
        body: JSON.stringify({ action: 'select', x: 200, y: 100, value: 'b' }),
      }),
    );
    expect(screen.queryByText('Option B')).not.toBeInTheDocument();
  });

  it("positions the select overlay from the select's own rect, not the click point, and disables disabled options", async () => {
    // Regression: the overlay used to render at the raw click coordinates
    // with a fixed min-width, drifting from where a real native dropdown
    // would actually appear (flush under the select's own box) the instant
    // the click landed anywhere but its exact top-left corner.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/status')) {
        return Promise.resolve(jsonResponse({ active: true, url: 'http://localhost:5173' }));
      }
      if (url.includes('/inspect')) {
        return Promise.resolve(
          jsonResponse({
            success: true,
            isSelect: true,
            value: 'a',
            // Page-space rect (1280x800 viewport) — with the 640x400 display
            // size mocked below, that's an exact 2x scale.
            rect: { x: 200, y: 80, width: 300, height: 40 },
            options: [
              { value: 'a', label: 'Option A', selected: true, disabled: false },
              { value: 'b', label: 'Option B', selected: false, disabled: true },
            ],
          }),
        );
      }
      if (url.includes('/interact')) return Promise.resolve(jsonResponse({ success: true }));
      if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    const img = screen.getByAltText('screenshotAlt');
    vi.spyOn(img, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 640,
      height: 400,
      right: 640,
      bottom: 400,
      toJSON: () => ({}),
    });

    await act(async () => {
      // Clicks somewhere well inside the select, NOT its top-left corner.
      fireEvent.click(img, { clientX: 250, clientY: 90 });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    const overlay = screen.getByRole('listbox');
    // rect.x/width scaled by 0.5 (640/1280), rect bottom edge (y+height) scaled the same way.
    expect(overlay.style.left).toBe('100px');
    expect(overlay.style.top).toBe('60px');
    expect(overlay.style.width).toBe('150px');

    const disabledOption = screen.getByText('Option B');
    expect(disabledOption).toBeDisabled();
    fetchMock.mockClear();
    fireEvent.click(disabledOption);
    expect(fetchMock).not.toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/interact',
      expect.anything(),
    );
  });

  it('typing a printable key relays a "type" action; Enter relays a "key" action', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/status')) {
        return Promise.resolve(jsonResponse({ active: true, url: 'http://localhost:5173' }));
      }
      if (url.includes('/interact')) return Promise.resolve(jsonResponse({ success: true }));
      if (url.includes('/screenshot')) return Promise.resolve(blobResponse([1, 2, 3]));
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TaskPreviewSection taskId={1} />);
    await flush();

    const container = screen.getByRole('application');
    fetchMock.mockClear();
    await act(async () => {
      fireEvent.keyDown(container, { key: 'a' });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/interact',
      expect.objectContaining({ body: JSON.stringify({ action: 'type', text: 'a' }) }),
    );

    fetchMock.mockClear();
    await act(async () => {
      fireEvent.keyDown(container, { key: 'Enter' });
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/tasks/1/preview/interact',
      expect.objectContaining({ body: JSON.stringify({ action: 'key', key: 'Enter' }) }),
    );
  });
});
