/**
 * useTestCorrelationMatrix.test
 *
 * Verifies the matrix fetch hook (success populates cells, failure surfaces
 * an error, loading always settles) and the drilldown fetch helper.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://api.test' }));

import {
  useTestCorrelationMatrix,
  fetchTestCorrelationDrilldown,
} from './useTestCorrelationMatrix';
import type { CorrelationCell, FailureDrilldownEntry } from '../test-correlation.types';

const CELL: CorrelationCell = {
  changedFile: 'a.ts',
  testFile: 'a.test.ts',
  correlation: 0.8,
  pValue: 0.01,
  sampleSize: 10,
  confidence: 'high',
  nonDeterministic: false,
};

describe('useTestCorrelationMatrix', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the matrix on mount and populates cells on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, windowMonths: 3, cells: [CELL] }),
    });
    const { result } = renderHook(() => useTestCorrelationMatrix(3));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/analytics/test-correlation/matrix?windowMonths=3',
    );
    expect(result.current.cells).toEqual([CELL]);
    expect(result.current.error).toBeNull();
  });

  it('sets an error and empty cells on an HTTP failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useTestCorrelationMatrix(3));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.cells).toEqual([]);
    expect(result.current.error).not.toBeNull();
  });

  it('sets an error when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useTestCorrelationMatrix(3));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
  });
});

describe('fetchTestCorrelationDrilldown', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns entries on success', async () => {
    const entries: FailureDrilldownEntry[] = [
      {
        runId: 'run-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        commitSha: 'abc',
        source: 'ci',
        environment: { platform: 'win32', runtimeVersion: '1.0.0' },
        flaky: false,
      },
    ];
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, entries }) });
    const result = await fetchTestCorrelationDrilldown('a.ts', 'a.test.ts', 3);
    expect(result).toEqual(entries);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/analytics/test-correlation/drilldown?changedFile=a.ts&testFile=a.test.ts&windowMonths=3',
    );
  });

  it('returns an empty array on HTTP failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({}) });
    const result = await fetchTestCorrelationDrilldown('a.ts', 'a.test.ts', 3);
    expect(result).toEqual([]);
  });

  it('returns an empty array when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const result = await fetchTestCorrelationDrilldown('a.ts', 'a.test.ts', 3);
    expect(result).toEqual([]);
  });
});
