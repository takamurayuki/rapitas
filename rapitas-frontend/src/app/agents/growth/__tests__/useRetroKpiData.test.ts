/**
 * useRetroKpiData.test
 *
 * Verifies the retro KPI fetch hook against the /agent-metrics/retro-kpi
 * envelope: success populates the ledger, `success:false` and HTTP errors
 * surface the shared error message, and loading always settles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { RetroKpiLedger } from '../types';

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { useRetroKpiData } from '../useRetroKpiData';

const LEDGER: RetroKpiLedger = { windowDays: 7, windows: [] };

describe('useRetroKpiData', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the retro-kpi endpoint and exposes the ledger on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: LEDGER }),
    });
    const { result } = renderHook(() => useRetroKpiData());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/agent-metrics/retro-kpi');
    expect(result.current.ledger).toEqual(LEDGER);
    expect(result.current.error).toBeNull();
  });

  it('surfaces the shared error message when the envelope is not successful', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'Failed to compute retro kpi metrics' }),
    });
    const { result } = renderHook(() => useRetroKpiData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ledger).toBeNull();
    expect(result.current.error).toBe('common.errorOccurred');
  });

  it('surfaces the shared error message on an HTTP error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useRetroKpiData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ledger).toBeNull();
    expect(result.current.error).toBe('common.errorOccurred');
  });
});
