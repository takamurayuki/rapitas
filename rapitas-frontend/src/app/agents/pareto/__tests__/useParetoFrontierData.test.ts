/**
 * useParetoFrontierData.test
 *
 * Verifies the default 30-day/all/all filters, the endpoint and query string
 * hit, refetch on filter change, and the error state on a failed response.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useParetoFrontierData } from '../useParetoFrontierData';

// Stable translator identity, as real next-intl provides — a fresh function
// per render would retrigger the fetch effect and mask the refetch count.
const stableT = (key: string) => key;
vi.mock('next-intl', () => ({
  useTranslations: () => stableT,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const payload = {
  windowDays: 30,
  from: '2026-07-29T00:00:00.000Z',
  to: '2026-08-28T00:00:00.000Z',
  totalExecutions: 12,
  filters: { complexityBand: 'all', role: 'all' },
  metrics: {
    resourceAxis: 'costUsd',
    cpuMemoryAvailable: false,
    confidenceLevel: 0.95,
    minReliableSamples: 5,
  },
  segments: [],
};

describe('useParetoFrontierData', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ success: true, data: payload }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the frontier with the default 30-day window and no filters', async () => {
    const { result } = renderHook(() => useParetoFrontierData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.frontier?.totalExecutions).toBe(12);
    expect(result.current.filters).toEqual({ days: 30, complexityBand: 'all', role: 'all' });
    expect(String(mockFetch.mock.calls[0][0])).toBe(
      'http://test:3001/agent-metrics/pareto-frontier?days=30&complexityBand=all&role=all',
    );
  });

  it('refetches when a filter changes', async () => {
    const { result } = renderHook(() => useParetoFrontierData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.setFilters((prev) => ({ ...prev, complexityBand: 'high', role: 'verifier' }));
    });

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(String(mockFetch.mock.calls[1][0])).toContain('complexityBand=high&role=verifier');
  });

  it('surfaces an error when the response is not ok', async () => {
    mockFetch.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const { result } = renderHook(() => useParetoFrontierData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('errorOccurred');
    expect(result.current.frontier).toBeNull();
  });
});
