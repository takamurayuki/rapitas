import { renderHook, waitFor, act } from '@testing-library/react';
import { useAnalyticsDashboard } from '../feature/useAnalyticsDashboard';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    transientError: vi.fn(),
  }),
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

describe('useAnalyticsDashboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to a 30-day range ending today when no initialRange is given', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ totalTasks: 0 }) }),
    );
    const { result } = renderHook(() => useAnalyticsDashboard());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const from = new Date(result.current.dateRange.from);
    const to = new Date(result.current.dateRange.to);
    const diffDays = Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000));
    expect(diffDays).toBe(30);
  });

  it('fetches analytics for a given initial range', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ totalTasks: 5, completedTasks: 2 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const range = { from: '2026-01-01', to: '2026-01-31' };
    const { result } = renderHook(() => useAnalyticsDashboard(range));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://test:3001/analytics/dashboard?from=2026-01-01&to=2026-01-31',
    );
    expect(result.current.data).toEqual({ totalTasks: 5, completedTasks: 2 });
  });

  it('sets isLoading true while the request is in flight', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const { result } = renderHook(() =>
      useAnalyticsDashboard({ from: '2026-01-01', to: '2026-01-02' }),
    );
    expect(result.current.isLoading).toBe(true);
  });

  it('leaves data null and stops loading on a fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { result } = renderHook(() =>
      useAnalyticsDashboard({ from: '2026-01-01', to: '2026-01-02' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it('setDateRange triggers a refetch with the new range', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ totalTasks: 1 }) });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() =>
      useAnalyticsDashboard({ from: '2026-01-01', to: '2026-01-02' }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      result.current.setDateRange({ from: '2026-02-01', to: '2026-02-28' });
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://test:3001/analytics/dashboard?from=2026-02-01&to=2026-02-28',
      );
    });
  });
});
