import { renderHook, act, waitFor } from '@testing-library/react';
import { useStudyProgress } from '../study/useStudyProgress';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('useStudyProgress', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return initial state when goalId is null', () => {
    const { result } = renderHook(() => useStudyProgress(null));

    expect(result.current.progress).toBe(0);
    expect(result.current.totalHours).toBe(0);
    expect(result.current.isOnTrack).toBe(false);
    expect(result.current.milestones).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should not fetch when goalId is null', () => {
    renderHook(() => useStudyProgress(null));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should fetch progress data and calculate correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalHours: 50,
        targetHours: 100,
        daysElapsed: 15,
        totalDays: 30,
      }),
    });

    const { result } = renderHook(() => useStudyProgress(1));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.progress).toBe(50);
    expect(result.current.totalHours).toBe(50);
    expect(result.current.isOnTrack).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('should calculate milestones correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalHours: 30,
        targetHours: 100,
        daysElapsed: 10,
        totalDays: 30,
      }),
    });

    const { result } = renderHook(() => useStudyProgress(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.milestones).toHaveLength(5);
    // 30 hours out of 100: 10% milestone (10 hours) achieved, 25% (25 hours) achieved, 50% (50 hours) not
    expect(result.current.milestones[0]).toEqual({
      label: '10%',
      targetHours: 10,
      achieved: true,
    });
    expect(result.current.milestones[1]).toEqual({
      label: '25%',
      targetHours: 25,
      achieved: true,
    });
    expect(result.current.milestones[2]).toEqual({
      label: '50%',
      targetHours: 50,
      achieved: false,
    });
    expect(result.current.milestones[3]).toEqual({
      label: '75%',
      targetHours: 75,
      achieved: false,
    });
    expect(result.current.milestones[4]).toEqual({
      label: '100%',
      targetHours: 100,
      achieved: false,
    });
  });

  it('should cap progress at 100%', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalHours: 150,
        targetHours: 100,
        daysElapsed: 30,
        totalDays: 30,
      }),
    });

    const { result } = renderHook(() => useStudyProgress(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.progress).toBe(100);
  });

  it('should handle fetch errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useStudyProgress(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
    expect(result.current.progress).toBe(0);
  });

  it('should handle non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });

    const { result } = renderHook(() => useStudyProgress(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('進捗データの取得に失敗しました');
  });

  it('should refresh data when refresh() is called', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalHours: 10,
        targetHours: 100,
        daysElapsed: 5,
        totalDays: 30,
      }),
    });

    const { result } = renderHook(() => useStudyProgress(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.progress).toBe(10);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalHours: 20,
        targetHours: 100,
        daysElapsed: 10,
        totalDays: 30,
      }),
    });

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.progress).toBe(20);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should determine isOnTrack correctly when behind schedule', async () => {
    // 10% progress when 50% of time has elapsed -> not on track
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalHours: 10,
        targetHours: 100,
        daysElapsed: 15,
        totalDays: 30,
      }),
    });

    const { result } = renderHook(() => useStudyProgress(1));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // expectedProgress = (15/30)*100 = 50, threshold = 50*0.9 = 45, progress = 10 < 45
    expect(result.current.isOnTrack).toBe(false);
  });

  it('should fetch correct URL with goalId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalHours: 0,
        targetHours: 100,
        daysElapsed: 1,
        totalDays: 30,
      }),
    });

    renderHook(() => useStudyProgress(42));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/learning-goals/42/progress');
    });
  });
});
