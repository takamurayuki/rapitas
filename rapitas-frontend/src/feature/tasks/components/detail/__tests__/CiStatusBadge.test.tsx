/**
 * CiStatusBadge
 *
 * Renders nothing without a linked PR, shows a status pill once one exists,
 * polls while the PR is open, and stops polling once it's terminal
 * (merged/closed) — mirrors AutoMergeWatcher's own 30s-scale cadence.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import CiStatusBadge from '../CiStatusBadge';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) };
}

/**
 * Flushes pending promise microtasks (fetch → res.json() → setState) WITHOUT
 * touching fake timers — vitest's runOnlyPendingTimersAsync treats a
 * registered setInterval as "pending" regardless of its 30s delay and fires
 * it immediately, which double-counts fetch calls in these tests. Advance
 * timers explicitly (vi.advanceTimersByTimeAsync) only in the tests that are
 * actually about polling cadence.
 */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe('CiStatusBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockPush.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing when the task has no linked PR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'no_pr' })));
    const { container } = render(<CiStatusBadge taskId={1} />);
    await flush();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a passing badge with the PR number', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ status: 'pass', prNumber: 42, prState: 'open' })),
    );
    render(<CiStatusBadge taskId={1} />);
    await flush();
    expect(screen.getByText(/passing/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('#42');
  });

  it('shows a failing badge', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ status: 'fail', prNumber: 7, prState: 'open' })),
    );
    render(<CiStatusBadge taskId={1} />);
    await flush();
    expect(screen.getByText(/failing/)).toBeInTheDocument();
  });

  it('opens the PR page when clicked', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'pass', prNumber: 42, prState: 'open' }))
      .mockResolvedValueOnce(jsonResponse({ id: 99, prNumber: 42 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CiStatusBadge taskId={1} />);
    await flush();
    expect(screen.getByText(/passing/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    expect(mockPush).toHaveBeenCalledWith('/github/pull-requests/99');
  });

  it('polls again while the PR stays open', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'pending', prNumber: 5, prState: 'open' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CiStatusBadge taskId={1} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops polling once the PR is merged', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ status: 'pass', prNumber: 5, prState: 'merged' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<CiStatusBadge taskId={1} />);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // Terminal state — no further polling ticks.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
