/**
 * useDeviationTimeline tests
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDeviationTimeline } from './useDeviationTimeline';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const mockFetch = vi.fn();

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

const timeline = {
  status: 'ok',
  entries: [],
  counts: { inPlan: 0, outOfPlan: 0, plannedNotExecuted: 0 },
  byKind: null,
  warnings: [],
  planHash: 'h',
  executionId: 9,
};

describe('useDeviationTimeline', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('fetches the timeline for the task', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(timeline));
    const { result } = renderHook(() => useDeviationTimeline(5));
    await waitFor(() => expect(result.current.timeline?.executionId).toBe(9));
    expect(mockFetch).toHaveBeenCalledWith('http://test:3001/workflow/tasks/5/deviation-timeline');
  });

  test('fetchContext requests lines around seq', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(timeline));
    mockFetch.mockReturnValueOnce(
      jsonResponse({ lines: [{ sequenceNumber: 3, text: 'x', isTarget: true }] }),
    );
    const { result } = renderHook(() => useDeviationTimeline(5));
    await waitFor(() => expect(result.current.timeline).not.toBeNull());
    let lines: unknown;
    await act(async () => {
      lines = await result.current.fetchContext(9, 3);
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://test:3001/workflow/executions/9/deviation-context?seq=3&before=5&after=5',
    );
    expect(lines).toEqual([{ sequenceNumber: 3, text: 'x', isTarget: true }]);
  });

  test('submitAudit posts with the UI source header and blocks double submits', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(timeline));
    let resolvePost: (v: unknown) => void = () => {};
    mockFetch.mockReturnValueOnce(new Promise((r) => (resolvePost = r)));
    const { result } = renderHook(() => useDeviationTimeline(5));
    await waitFor(() => expect(result.current.timeline).not.toBeNull());

    let first: Promise<boolean> = Promise.resolve(false);
    let second = true;
    await act(async () => {
      first = result.current.submitAudit('approved', 'looks fine');
    });
    expect(result.current.submitting).toBe(true);
    await act(async () => {
      second = await result.current.submitAudit('approved', 'again');
    });
    expect(second).toBe(false);
    await act(async () => {
      resolvePost({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
      await first;
    });
    expect(await first).toBe(true);
    const postCalls = mockFetch.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(postCalls).toHaveLength(1);
    expect(postCalls[0][0]).toBe('http://test:3001/workflow/tasks/5/deviation-audit');
    expect(postCalls[0][1].headers['X-Rapitas-Source']).toBe('ui');
    expect(JSON.parse(postCalls[0][1].body)).toEqual({
      decision: 'approved',
      comment: 'looks fine',
      executionId: 9,
    });
    expect(result.current.submitting).toBe(false);
  });

  test('a failed submit surfaces an error', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(timeline));
    mockFetch.mockReturnValueOnce(jsonResponse({ success: false, error: 'boom' }, false, 500));
    const { result } = renderHook(() => useDeviationTimeline(5));
    await waitFor(() => expect(result.current.timeline).not.toBeNull());
    let ok = true;
    await act(async () => {
      ok = await result.current.submitAudit('rejected', '');
    });
    expect(ok).toBe(false);
    expect(result.current.submitError).toBe('boom');
  });
});
