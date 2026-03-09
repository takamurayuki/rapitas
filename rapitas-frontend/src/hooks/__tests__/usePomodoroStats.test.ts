import { renderHook, act, waitFor } from '@testing-library/react';
import { usePomodoroStats } from '../usePomodoroStats';

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockStats = {
  todayCompleted: 3,
  todayMinutes: 75,
  weeklyCompleted: 15,
  weeklyMinutes: 375,
  totalCompleted: 100,
  averageFocusMinutes: 25,
};

describe('usePomodoroStats', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStats),
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should start with loading state and empty stats', () => {
    const { result } = renderHook(() => usePomodoroStats());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.stats.todayCompleted).toBe(0);
  });

  it('should fetch stats on mount', async () => {
    const { result } = renderHook(() => usePomodoroStats());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.stats).toEqual(mockStats);
    expect(result.current.error).toBeNull();
    expect(fetch).toHaveBeenCalledWith('http://test:3001/pomodoro/stats');
  });

  it('should compute todayTotal from stats', async () => {
    const { result } = renderHook(() => usePomodoroStats());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.todayTotal).toBe(75);
  });

  it('should compute weeklyAverage', async () => {
    const { result } = renderHook(() => usePomodoroStats());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Math.round(375 / 7) = 54
    expect(result.current.weeklyAverage).toBe(54);
  });

  it('should return 0 for weeklyAverage when no weekly completions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...mockStats,
            weeklyCompleted: 0,
            weeklyMinutes: 0,
          }),
      }),
    );

    const { result } = renderHook(() => usePomodoroStats());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.weeklyAverage).toBe(0);
  });

  it('should handle fetch error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    const { result } = renderHook(() => usePomodoroStats());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Failed to fetch stats: 500');
  });

  it('should handle network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error')),
    );

    const { result } = renderHook(() => usePomodoroStats());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('should refresh stats when calling refresh', async () => {
    const { result } = renderHook(() => usePomodoroStats());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
