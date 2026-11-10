/**
 * model-route-stability.constraints.test
 *
 * Locks the pin's reuse rules against the CURRENT routing constraints
 * (routing2a D): the budget ceiling (hardCapTier) is part of the pin's
 * identity, a reused decision must still satisfy minTier / hardCapTier / role,
 * and the in-memory cache honours the same TTL as the persisted pin.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let routeCounter = 0;
const tiered = (tier: string) => () =>
  Promise.resolve({ recommendedModel: `model-${routeCounter++}`, recommendedTier: tier });
const mockGetSmartRoute = mock(tiered('standard'));

mock.module('./smart-model-router', () => ({
  getSmartRoute: mockGetSmartRoute,
}));

let persisted: { correlationId?: string; payload: Record<string, unknown>; createdAt: Date }[] = [];
mock.module('../memory/timeline', () => ({
  appendEvent: async (event: { correlationId?: string; payload: Record<string, unknown> }) => {
    persisted.push({ ...event, createdAt: new Date() });
    return { id: persisted.length };
  },
  queryEvents: async (options: { correlationId?: string }) => {
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

const { getStableSmartRoute, _resetStableRouteCache, PIN_TTL_MS } =
  await import('./model-route-stability');

/** Let the un-awaited pin write settle, then forget process memory. */
const restart = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  _resetStableRouteCache();
};

/** A stored pin row as an older build (or another role) could have left it. */
const storedPin = (payload: Record<string, unknown>) => ({
  correlationId: 'route_1_implementer',
  payload: { taskId: 1, minTier: null, capTier: null, hardCapTier: null, ...payload },
  createdAt: new Date(),
});

beforeEach(() => {
  persisted = [];
  _resetStableRouteCache();
  routeCounter = 0;
  mockGetSmartRoute.mockReset();
  mockGetSmartRoute.mockImplementation(tiered('standard'));
});

describe('hardCapTier is part of the pin identity', () => {
  it('re-routes in memory when only the budget cap changes', async () => {
    // Task crossed its budget: same minTier/capTier, new hardCapTier. Before
    // the fix the premium pin kept being served for 24 h past the cap.
    mockGetSmartRoute.mockImplementationOnce(tiered('premium'));
    mockGetSmartRoute.mockImplementationOnce(tiered('economy'));
    const before = await getStableSmartRoute(1, 'implementer', { minTier: 'standard' });
    const after = await getStableSmartRoute(1, 'implementer', {
      minTier: 'standard',
      hardCapTier: 'economy',
    });
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(2);
    expect(after.recommendedTier).toBe('economy');
    expect(after).not.toBe(before);
  });

  it('re-routes in memory when the budget cap is lifted', async () => {
    mockGetSmartRoute.mockImplementationOnce(tiered('standard'));
    mockGetSmartRoute.mockImplementationOnce(tiered('premium'));
    await getStableSmartRoute(1, 'implementer', { hardCapTier: 'standard' });
    const lifted = await getStableSmartRoute(1, 'implementer');
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(2);
    expect(lifted.recommendedTier).toBe('premium');
  });

  it('re-routes after a restart when only the budget cap changes', async () => {
    mockGetSmartRoute.mockImplementationOnce(tiered('premium'));
    await getStableSmartRoute(1, 'implementer', { minTier: 'standard' });
    await restart();
    mockGetSmartRoute.mockImplementationOnce(tiered('economy'));
    await getStableSmartRoute(1, 'implementer', { minTier: 'standard', hardCapTier: 'economy' });
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(2);
  });

  it('re-routes after a restart when the budget cap is lifted', async () => {
    // The capped decision still fits "no cap", so only the key keeps it from
    // pinning the task to the cheaper tier after the ceiling goes away.
    persisted.push(
      storedPin({
        role: 'implementer',
        hardCapTier: 'standard',
        decision: { recommendedModel: 'capped-sonnet', recommendedTier: 'standard' },
      }),
    );
    mockGetSmartRoute.mockImplementationOnce(tiered('premium'));
    const r = await getStableSmartRoute(1, 'implementer');
    expect(r.recommendedModel).not.toBe('capped-sonnet');
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(1);
  });

  it('persists the hardCapTier with the pin', async () => {
    mockGetSmartRoute.mockImplementationOnce(tiered('economy'));
    await getStableSmartRoute(1, 'implementer', { hardCapTier: 'economy' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(persisted[0]?.payload.hardCapTier).toBe('economy');
  });

  it('treats a legacy pin without hardCapTier as uncapped', async () => {
    // Pins written before this change have no hardCapTier field at all.
    persisted.push({
      correlationId: 'route_1_implementer',
      payload: {
        taskId: 1,
        role: 'implementer',
        minTier: null,
        capTier: null,
        decision: { recommendedModel: 'legacy-opus', recommendedTier: 'premium' },
      },
      createdAt: new Date(),
    });
    const capped = await getStableSmartRoute(1, 'implementer', { hardCapTier: 'economy' });
    expect(capped.recommendedModel).not.toBe('legacy-opus');
    _resetStableRouteCache();
    const uncapped = await getStableSmartRoute(1, 'implementer');
    expect(uncapped.recommendedModel).toBe('legacy-opus');
  });
});

describe('a reused decision must satisfy the current constraints', () => {
  it('does not reuse a stored decision above the current hard cap', async () => {
    persisted.push(
      storedPin({
        role: 'implementer',
        hardCapTier: 'economy',
        decision: { recommendedModel: 'opus', recommendedTier: 'premium' },
      }),
    );
    mockGetSmartRoute.mockImplementationOnce(tiered('economy'));
    const r = await getStableSmartRoute(1, 'implementer', { hardCapTier: 'economy' });
    expect(r.recommendedModel).not.toBe('opus');
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a decision below the current floor (a shortfall pin)', async () => {
    // Nothing premium was usable at the time; the next call must look again
    // instead of locking the shortfall in for 24 h.
    mockGetSmartRoute.mockImplementationOnce(tiered('standard'));
    mockGetSmartRoute.mockImplementationOnce(tiered('premium'));
    await getStableSmartRoute(1, 'implementer', { minTier: 'premium' });
    const again = await getStableSmartRoute(1, 'implementer', { minTier: 'premium' });
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(2);
    expect(again.recommendedTier).toBe('premium');
  });

  it('does not reuse a decision the router itself flagged as a shortfall', async () => {
    // Tier looks fine, but the router said the route missed its requirement
    // (e.g. the model is not suitable for the role); look again next time.
    mockGetSmartRoute.mockImplementationOnce(() =>
      Promise.resolve({
        recommendedModel: 'unsuitable',
        recommendedTier: 'standard',
        constraintShortfall: { kind: 'role', requiredTier: 'standard', selectedTier: 'standard' },
      }),
    );
    await getStableSmartRoute(1, 'implementer', { minTier: 'standard' });
    const again = await getStableSmartRoute(1, 'implementer', { minTier: 'standard' });
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(2);
    expect(again.recommendedModel).not.toBe('unsuitable');
  });

  it('reuses a decision that satisfies floor and cap', async () => {
    const first = await getStableSmartRoute(1, 'implementer', {
      minTier: 'standard',
      hardCapTier: 'standard',
    });
    const second = await getStableSmartRoute(1, 'implementer', {
      minTier: 'standard',
      hardCapTier: 'standard',
    });
    expect(second).toBe(first);
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a stored pin written for another role', async () => {
    persisted.push(
      storedPin({
        role: 'verifier',
        decision: { recommendedModel: 'foreign', recommendedTier: 'standard' },
      }),
    );
    const r = await getStableSmartRoute(1, 'implementer');
    expect(r.recommendedModel).not.toBe('foreign');
    expect(mockGetSmartRoute).toHaveBeenCalledTimes(1);
  });
});

describe('the in-memory pin honours the TTL', () => {
  it('re-routes an in-memory pin once its TTL has passed', async () => {
    // Before: memory was consulted first and never looked at age, so a
    // long-lived process served the same pin forever.
    const realNow = Date.now;
    try {
      await getStableSmartRoute(1, 'implementer');
      const later = realNow() + PIN_TTL_MS + 60_000;
      Date.now = () => later;
      await getStableSmartRoute(1, 'implementer');
      expect(mockGetSmartRoute).toHaveBeenCalledTimes(2);
    } finally {
      Date.now = realNow;
    }
  });

  it('still serves an in-memory pin inside its TTL', async () => {
    const realNow = Date.now;
    try {
      const first = await getStableSmartRoute(1, 'implementer');
      const later = realNow() + PIN_TTL_MS - 60_000;
      Date.now = () => later;
      expect(await getStableSmartRoute(1, 'implementer')).toBe(first);
      expect(mockGetSmartRoute).toHaveBeenCalledTimes(1);
    } finally {
      Date.now = realNow;
    }
  });
});
