/**
 * useUsageBudget tests
 *
 * Verifies the initial load of usage / status / rules / themes, the error
 * state, and that a successful save re-fetches while a failed save does not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useUsageBudget } from './useUsageBudget';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://api.test' }));

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

function routes(putOk = true) {
  return vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'PUT')
      return Promise.resolve({ ok: putOk, status: putOk ? 200 : 400 } as Response);
    if (url.includes('/theme-usage')) {
      return Promise.resolve(
        okJson({
          success: true,
          data: { days: 14, usdJpyRate: 150, unresolvedCount: 0, themes: [], daily: [] },
        }),
      );
    }
    if (url.includes('/usage-budget/status')) {
      return Promise.resolve(
        okJson({ success: true, data: { configured: false, suggestedShares: [] } }),
      );
    }
    if (url.includes('/usage-budget/rules')) {
      return Promise.resolve(okJson({ success: true, data: [] }));
    }
    return Promise.resolve(okJson([{ id: 1, name: 'Alpha', extra: true }]));
  });
}

let fetchMock: ReturnType<typeof routes>;

beforeEach(() => {
  fetchMock = routes();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('useUsageBudget', () => {
  it('loads usage, status, rules and themes', async () => {
    const { result } = renderHook(() => useUsageBudget());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(false);
    expect(result.current.status?.configured).toBe(false);
    expect(result.current.themes).toEqual([{ id: 1, name: 'Alpha' }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('days=14&tzOffsetMinutes=');
  });

  it('reports an error when an API call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    const { result } = renderHook(() => useUsageBudget());
    await waitFor(() => expect(result.current.error).toBe(true));
  });

  it('re-fetches after a successful save', async () => {
    const { result } = renderHook(() => useUsageBudget());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = fetchMock.mock.calls.length;
    let ok = false;
    await act(async () => {
      ok = await result.current.saveBudget({ unit: 'tokens', monthlyLimit: 100, shares: [] });
    });
    expect(ok).toBe(true);
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before + 1));
  });

  it('does not re-fetch after a failed save', async () => {
    fetchMock = routes(false);
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useUsageBudget());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = fetchMock.mock.calls.length;
    let ok = true;
    await act(async () => {
      ok = await result.current.saveRules([]);
    });
    expect(ok).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });
});
