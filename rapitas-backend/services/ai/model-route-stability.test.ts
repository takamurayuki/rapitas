/**
 * model-route-stability.test
 *
 * Locks the per-(taskId, role, minTier) route-pinning guarantee: repeat calls
 * return the SAME model within the process (no mid-phase model switch on a
 * retry), a different minTier re-routes, and invalidation clears the pin.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Each getSmartRoute call returns a distinct object so we can detect whether a
// call was served from the pin (same reference) or recomputed (new reference).
let routeCounter = 0;
const mockGetSmartRoute = mock(() =>
  Promise.resolve({
    model: `model-${routeCounter++}`,
    provider: 'anthropic-api',
    reason: 'test',
  }),
);

mock.module('./smart-model-router', () => ({
  getSmartRoute: mockGetSmartRoute,
}));

const { getStableSmartRoute, invalidateStableRoute, _resetStableRouteCache } =
  await import('./model-route-stability');

describe('getStableSmartRoute — route pinning', () => {
  beforeEach(() => {
    _resetStableRouteCache();
    routeCounter = 0;
    mockGetSmartRoute.mockClear();
  });

  it('returns the SAME pinned decision across repeat calls for the same key', async () => {
    const first = await getStableSmartRoute(1, 'implementer');
    const second = await getStableSmartRoute(1, 'implementer');
    expect(second).toBe(first);
    expect(second.model).toBe(first.model);
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(1);
  });

  it('re-routes for a different minTier (deliberate escalation)', async () => {
    const low = await getStableSmartRoute(1, 'implementer', { minTier: 'low' });
    const high = await getStableSmartRoute(1, 'implementer', { minTier: 'high' });
    expect(high.model).not.toBe(low.model);
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(2);
  });

  it('recomputes fresh after invalidateStableRoute clears the pin', async () => {
    const before = await getStableSmartRoute(2, 'verifier');
    invalidateStableRoute(2, 'verifier');
    const after = await getStableSmartRoute(2, 'verifier');
    expect(after).not.toBe(before);
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(2);
  });
});
