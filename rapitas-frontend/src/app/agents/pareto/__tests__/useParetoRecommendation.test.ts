/**
 * useParetoRecommendation.test
 *
 * Verifies that the hook does not auto-fetch, that recommend() hits the
 * recommend endpoint with filters + goal, that reset() clears the result,
 * and that failures surface as an error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useParetoRecommendation } from '../useParetoRecommendation';

// Stable translator identity, as real next-intl provides.
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

const filters = { days: 30, complexityBand: 'medium' as const, role: 'implementer' };
const payload = {
  goal: { kind: 'successRate', value: 95 },
  windowDays: 30,
  filters: { complexityBand: 'medium', role: 'implementer' },
  metrics: {
    resourceAxis: 'costUsd',
    cpuMemoryAvailable: false,
    confidenceLevel: 0.95,
    minReliableSamples: 5,
  },
  recommendations: [],
};

describe('useParetoRecommendation', () => {
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

  it('does not fetch until recommend() is called', () => {
    const { result } = renderHook(() => useParetoRecommendation(filters));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.result).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('hits the recommend endpoint with filters and goal, then exposes the result', async () => {
    const { result } = renderHook(() => useParetoRecommendation(filters));

    await act(async () => {
      await result.current.recommend({ kind: 'successRate', value: 95 });
    });

    expect(String(mockFetch.mock.calls[0][0])).toBe(
      'http://test:3001/agent-metrics/pareto-frontier/recommend?days=30&complexityBand=medium&role=implementer&goal=successRate&value=95',
    );
    await waitFor(() => expect(result.current.result?.goal.value).toBe(95));

    act(() => result.current.reset());
    expect(result.current.result).toBeNull();
  });

  it('surfaces an error on a failed response', async () => {
    mockFetch.mockImplementation(async () => ({ ok: false, status: 400, json: async () => ({}) }));
    const { result } = renderHook(() => useParetoRecommendation(filters));

    await act(async () => {
      await result.current.recommend({ kind: 'cost', value: 20 });
    });

    expect(result.current.error).toBe('errorOccurred');
    expect(result.current.result).toBeNull();
  });
});
