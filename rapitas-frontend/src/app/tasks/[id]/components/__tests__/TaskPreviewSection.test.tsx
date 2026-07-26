/**
 * TaskPreviewSection
 *
 * Idle by default; restores an already-running session on mount; starting
 * transitions to a polling screenshot view; a failed start shows the error;
 * stop tears the session down and returns to idle.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
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
});
