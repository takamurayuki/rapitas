/**
 * useMetricsData tests
 *
 * Verifies the default 7-day date-range window, that the utilization endpoint
 * is fetched alongside the other metrics, and that refetch re-runs all
 * requests with the current filters (manual refresh, no polling).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useMetricsData } from './useMetricsData';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const utilizationPayload = {
  startDate: '2026-08-11',
  endDate: '2026-08-17',
  dayCount: 7,
  daily: [{ date: '2026-08-11', byRole: { implementer: 0.5 }, byAgent: { 'claude-code': 0.5 } }],
  roles: [{ role: 'implementer', utilization: 0.5 }],
  agents: [{ agent: 'claude-code', utilization: 0.5 }],
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

describe('useMetricsData', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () => (url.includes('/utilization') ? utilizationPayload : {}),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults the date range to the trailing 7 days (incl. today)', async () => {
    const { result } = renderHook(() => useMetricsData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dateRange.startDate).toBe(isoDaysAgo(6));
    expect(result.current.dateRange.endDate).toBe(isoDaysAgo(0));
    expect(result.current.trendDays).toBe(7);
  });

  it('fetches the utilization endpoint with the date-range params', async () => {
    const { result } = renderHook(() => useMetricsData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    const utilizationCall = mockFetch.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes('/agent-metrics/utilization'));
    expect(utilizationCall).toBeDefined();
    expect(utilizationCall).toContain(`startDate=${isoDaysAgo(6)}`);
    expect(utilizationCall).toContain(`endDate=${isoDaysAgo(0)}`);
    expect(result.current.utilization).toEqual(utilizationPayload);
  });

  it('refetch re-runs all requests with the current filters', async () => {
    const { result } = renderHook(() => useMetricsData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    const callsAfterMount = mockFetch.mock.calls.length;
    expect(callsAfterMount).toBe(5);

    await act(async () => {
      await result.current.refetch();
    });
    expect(mockFetch.mock.calls.length).toBe(callsAfterMount + 5);
  });
});
