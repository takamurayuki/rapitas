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

/** Pins are persisted now; the store stands in for the timeline. */
let persisted: { correlationId?: string; payload: Record<string, unknown>; createdAt: Date }[] = [];
let readFails = false;
mock.module('../memory/timeline', () => ({
  appendEvent: async (event: { correlationId?: string; payload: Record<string, unknown> }) => {
    persisted.push({ ...event, createdAt: new Date() });
    return { id: persisted.length };
  },
  queryEvents: async (options: { correlationId?: string }) => {
    if (readFails) throw new Error('timeline unavailable');
    const events = persisted.filter(
      (e) => !options.correlationId || e.correlationId === options.correlationId,
    );
    return { events, total: events.length, limit: 50, offset: 0 };
  },
  deleteEvents: async (filter: { correlationId: string }) => {
    const before = persisted.length;
    persisted = persisted.filter((e) => e.correlationId !== filter.correlationId);
    return before - persisted.length;
  },
}));

const { getStableSmartRoute, invalidateStableRoute, _resetStableRouteCache, PIN_TTL_MS } =
  await import('./model-route-stability');

describe('getStableSmartRoute — route pinning', () => {
  beforeEach(() => {
    persisted = [];
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

describe('surviving a restart', () => {
  // The reason this module stopped being memory-only. Measured 2026-10-21:
  // this backend restarts on every deploy and at every auto-run quiet
  // point, and 523 executions over fourteen days ran across three tiers.
  // A task whose workflow spans a restart could change model between its
  // own phases — the one thing the pin exists to stop.
  beforeEach(() => {
    persisted = [];
    readFails = false;
    _resetStableRouteCache();
    mockGetSmartRoute.mockClear();
  });

  /**
   * Forget everything this process held.
   *
   * The pin is written without being awaited — a route must not wait on a
   * database — so the write is let settle before the memory is dropped,
   * which a real restart does for free by taking milliseconds.
   */
  const restart = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    _resetStableRouteCache();
  };

  it('gives the same model back after the process forgets', async () => {
    const before = await getStableSmartRoute(1, 'implementer');
    await restart();
    const after = await getStableSmartRoute(1, 'implementer');
    expect(after).toEqual(before);
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(1);
  });

  it('still re-routes for a deliberate escalation', async () => {
    // A different minTier is a different decision, not the same one.
    const base = await getStableSmartRoute(1, 'implementer');
    await restart();
    const escalated = await getStableSmartRoute(1, 'implementer', { minTier: 'premium' });
    expect(escalated).not.toEqual(base);
  });

  it('keeps one task apart from another', async () => {
    const one = await getStableSmartRoute(1, 'implementer');
    await restart();
    const two = await getStableSmartRoute(2, 'implementer');
    expect(two).not.toEqual(one);
  });

  it('keeps one role apart from another', async () => {
    const impl = await getStableSmartRoute(1, 'implementer');
    await restart();
    const verify = await getStableSmartRoute(1, 'verifier');
    expect(verify).not.toEqual(impl);
  });

  it('drops only the invalidated role, across a restart', async () => {
    // A provider-failure re-route must not unpin the task's other phases.
    const impl = await getStableSmartRoute(1, 'implementer');
    const verify = await getStableSmartRoute(1, 'verifier');
    await invalidateStableRoute(1, 'implementer');
    await restart();
    expect(await getStableSmartRoute(1, 'implementer')).not.toEqual(impl);
    expect(await getStableSmartRoute(1, 'verifier')).toEqual(verify);
  });

  it('re-routes a pin older than a day', async () => {
    await getStableSmartRoute(1, 'implementer');
    for (const row of persisted) {
      row.createdAt = new Date(Date.now() - PIN_TTL_MS - 60_000);
    }
    await restart();
    await getStableSmartRoute(1, 'implementer');
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(2);
  });

  it('routes fresh when the store cannot be read', async () => {
    // A pin store that is down must never stop a phase from routing: the
    // fallback is a fresh decision, which is what this module replaced.
    const first = await getStableSmartRoute(1, 'implementer');
    await restart();
    readFails = true;
    const second = await getStableSmartRoute(1, 'implementer');
    expect(second).not.toEqual(first);
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(2);
  });
});
