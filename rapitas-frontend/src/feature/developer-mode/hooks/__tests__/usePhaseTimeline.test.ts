/**
 * usePhaseTimeline unit tests
 *
 * Verifies the fetch/cache contract task #785 relies on: one call per
 * mount, cache reuse across remounts of the same task, and graceful error
 * surfacing for a 404/network failure.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { usePhaseTimeline } from '../usePhaseTimeline';

const mockFetch = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

const samplePhases = [
  {
    phaseType: 'research',
    iterations: [
      {
        iterationNumber: 1,
        executionIds: [1],
        startedAt: '2026-08-30T00:00:00.000Z',
        completedAt: '2026-08-30T00:05:00.000Z',
        status: 'completed',
        logLineCount: 10,
        boundaryUncertain: false,
        summary: {
          status: 'completed',
          durationMs: 300000,
          logLineCount: 10,
          testPass: null,
          testFail: null,
        },
      },
    ],
  },
];

describe('usePhaseTimeline', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches phase timeline data on mount', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({ success: true, phases: samplePhases, workflowMode: 'standard' }),
    );

    const { result } = renderHook(() => usePhaseTimeline(9001));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.phases).toEqual(samplePhases);
    expect(result.current.workflowMode).toBe('standard');
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/workflow/tasks/9001/phase-timeline');
  });

  it('surfaces an error and empty phases on a failed response', async () => {
    mockFetch.mockReturnValue(jsonResponse({ success: false, error: 'not found' }, false, 404));

    const { result } = renderHook(() => usePhaseTimeline(9002));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.phases).toEqual([]);
  });

  it('reuses the cache on a second mount for the same task without refetching first', async () => {
    mockFetch.mockReturnValue(
      jsonResponse({ success: true, phases: samplePhases, workflowMode: 'standard' }),
    );

    const first = renderHook(() => usePhaseTimeline(9003));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    first.unmount();

    const second = renderHook(() => usePhaseTimeline(9003));
    // Cached data is available synchronously on the very first render.
    expect(second.result.current.phases).toEqual(samplePhases);
    expect(second.result.current.loading).toBe(false);
  });
});
