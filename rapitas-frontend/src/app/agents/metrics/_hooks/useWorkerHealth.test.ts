/**
 * useWorkerHealth tests
 *
 * Verifies the four states: loading -> success, error (HTTP and envelope), empty.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWorkerHealth } from './useWorkerHealth';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://api.test' }));

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe('useWorkerHealth', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('starts loading, then reports success with data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okJson({
          success: true,
          data: { points: [{ t: 'x' }], weights: {}, rules: {}, detection: {} },
        }),
      ),
    );
    const { result } = renderHook(() => useWorkerHealth());
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('success'));
    expect(result.current.data?.points).toHaveLength(1);
  });

  it('reports empty when there are no points', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okJson({ success: true, data: { points: [] } })),
    );
    const { result } = renderHook(() => useWorkerHealth());
    await waitFor(() => expect(result.current.status).toBe('empty'));
  });

  it('reports error on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));
    const { result } = renderHook(() => useWorkerHealth());
    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  it('reports error when the envelope says failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson({ success: false })));
    const { result } = renderHook(() => useWorkerHealth());
    await waitFor(() => expect(result.current.status).toBe('error'));
  });
});
