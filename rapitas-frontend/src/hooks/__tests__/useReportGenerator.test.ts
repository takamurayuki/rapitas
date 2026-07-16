import { renderHook, act } from '@testing-library/react';
import { useReportGenerator } from '../feature/useReportGenerator';

vi.mock('next-intl', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  return { useTranslations: () => t };
});
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

describe('useReportGenerator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with no report, not generating, no error', () => {
    const { result } = renderHook(() => useReportGenerator());
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.lastReport).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('generateReport fetches weekly by default and stores the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          weekStart: '2026-01-01',
          weekEnd: '2026-01-07',
          stats: {
            totalTasks: 1,
            completedTasks: 1,
            completionRate: 100,
            averageCompletionDays: 1,
          },
          trends: [],
          topCategories: [],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useReportGenerator());
    await act(async () => {
      await result.current.generateReport();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/reports/weekly', expect.anything());
    expect(result.current.lastReport?.weekStart).toBe('2026-01-01');
    expect(result.current.isGenerating).toBe(false);
  });

  it('generateReport fetches the requested report type', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          weekStart: '2026-01-01',
          weekEnd: '2026-01-31',
          stats: { totalTasks: 0, completedTasks: 0, completionRate: 0, averageCompletionDays: 0 },
          trends: [],
          topCategories: [],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useReportGenerator());
    await act(async () => {
      await result.current.generateReport('monthly');
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/analytics/reports/monthly', expect.anything());
  });

  it('sets an error message on a failed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const { result } = renderHook(() => useReportGenerator());
    await act(async () => {
      await result.current.generateReport();
    });

    expect(result.current.error).toContain('useReportGenerator.generateFailed');
    expect(result.current.lastReport).toBeNull();
  });

  it('silently ignores an AbortError without setting error state', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    const { result } = renderHook(() => useReportGenerator());
    await act(async () => {
      await result.current.generateReport();
    });

    expect(result.current.error).toBeNull();
  });

  it('clearReport resets report and error state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const { result } = renderHook(() => useReportGenerator());
    await act(async () => {
      await result.current.generateReport();
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      result.current.clearReport();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.lastReport).toBeNull();
  });
});
