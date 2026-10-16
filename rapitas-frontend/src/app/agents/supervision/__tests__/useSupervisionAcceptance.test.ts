/**
 * useSupervisionAcceptance.test
 *
 * The hook exposes the acceptance status on success, and treats HTTP errors and
 * malformed/`success:false` envelopes as errors instead of an empty status.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://api.test' }));

import { useSupervisionAcceptance } from '../_hooks/useSupervisionAcceptance';

const STATUS = {
  success: true,
  met: false,
  streakCount: 3,
  streakStartAt: '2026-09-11T00:00:00.000Z',
  hoursSinceLastIntervention: 5.5,
  observedGapMinutes: 12,
  reasonCodes: ['streak_task_count_below_threshold', 'knowledge_reuse_evidence_insufficient'],
  blockingTaskIds: [895],
  evalSetVersion: null,
  denominators: { heartbeatCount: 330 },
  snapshotAt: '2026-09-12T00:00:00.000Z',
  snapshotAgeMinutes: 2,
  heartbeatCount: 330,
  lastHeartbeatAt: '2026-09-12T00:01:00.000Z',
  heartbeatAgeSeconds: 20,
};

describe('useSupervisionAcceptance', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the acceptance-status endpoint and exposes the status', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => STATUS });
    const { result } = renderHook(() => useSupervisionAcceptance());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/agents/supervision/acceptance-status');
    expect(result.current.error).toBe(false);
    expect(result.current.status?.streakCount).toBe(3);
    expect(result.current.status?.reasonCodes).toContain('knowledge_reuse_evidence_insufficient');
  });

  it('flags an HTTP error and exposes no status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { result } = renderHook(() => useSupervisionAcceptance());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(true);
    expect(result.current.status).toBeNull();
  });

  it('treats a malformed envelope as an error rather than a met status', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const { result } = renderHook(() => useSupervisionAcceptance());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(true);
    expect(result.current.status).toBeNull();
  });
});
