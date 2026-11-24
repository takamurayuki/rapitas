/**
 * useLatestTransitionCause.test
 *
 * The hook reads the newest transition cause, re-reads it while the workflow
 * is in_progress (the diff review can finish at any moment), and stops
 * reading when disabled or unmounted.
 */
import { renderHook, act } from '@testing-library/react';
import { useLatestTransitionCause, LATEST_CAUSE_POLL_MS } from '../useLatestTransitionCause';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

function respond(causes: Array<string | null>) {
  return {
    ok: true,
    json: async () => ({ success: true, transitions: causes.map((cause) => ({ cause })) }),
  };
}

describe('useLatestTransitionCause', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns the newest cause from the transitions endpoint', async () => {
    mockFetch.mockResolvedValue(respond(['file_saved:verify', 'verify_review_pending']));
    const { result } = renderHook(() =>
      useLatestTransitionCause(5, { enabled: true, status: 'in_progress' }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockFetch).toHaveBeenCalledWith('http://test:3001/workflow/tasks/5/transitions');
    expect(result.current).toBe('verify_review_pending');
  });

  it('re-reads while in_progress so the label follows the review', async () => {
    mockFetch
      .mockResolvedValueOnce(respond(['verify_review_pending']))
      .mockResolvedValue(respond(['verify_review_pending', 'verify_review_admitted']));
    const { result } = renderHook(() =>
      useLatestTransitionCause(5, { enabled: true, status: 'in_progress' }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBe('verify_review_pending');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATEST_CAUSE_POLL_MS);
    });
    expect(result.current).toBe('verify_review_admitted');
  });

  it('does not poll outside in_progress, and fetches nothing when disabled', async () => {
    mockFetch.mockResolvedValue(respond(['x']));
    renderHook(() => useLatestTransitionCause(5, { enabled: true, status: 'blocked' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATEST_CAUSE_POLL_MS * 3);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockClear();
    const { result } = renderHook(() =>
      useLatestTransitionCause(5, { enabled: false, status: 'in_progress' }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATEST_CAUSE_POLL_MS);
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('stops polling after unmount', async () => {
    mockFetch.mockResolvedValue(respond(['verify_review_pending']));
    const { unmount } = renderHook(() =>
      useLatestTransitionCause(5, { enabled: true, status: 'in_progress' }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
    mockFetch.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LATEST_CAUSE_POLL_MS * 2);
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps null when the endpoint fails or returns no transitions', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const { result } = renderHook(() =>
      useLatestTransitionCause(5, { enabled: true, status: 'blocked' }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current).toBeNull();
  });
});
