/**
 * outcome-reinforcement.durable.test
 *
 * Verifies the DURABLE (timeline-backed) retrieval trace: retrievals are
 * persisted as memory_retrieval events, an outcome that arrives after a
 * restart (in-memory trace gone) still reinforces from the durable copy, the
 * two sources merge without double-counting, and consumed events are deleted
 * so a duplicate outcome never re-applies. Kept in its own file because
 * mock.module is process-global and the sibling test file intentionally runs
 * against the REAL (failing-silently) timeline.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

const boosted: number[] = [];
const penalized: number[] = [];
mock.module('./forgetting', () => ({
  boostDecayOnAccess: (id: number) => {
    boosted.push(id);
    return Promise.resolve();
  },
  penalizeOnFailure: (id: number) => {
    penalized.push(id);
    return Promise.resolve();
  },
}));

// In-memory stand-in for the timeline event store.
let events: Array<{ eventType: string; correlationId?: string; payload: Record<string, unknown> }> =
  [];
mock.module('./timeline', () => ({
  appendEvent: (e: {
    eventType: string;
    correlationId?: string;
    payload?: Record<string, unknown>;
  }) => {
    events.push({
      eventType: e.eventType,
      correlationId: e.correlationId,
      payload: e.payload ?? {},
    });
    return Promise.resolve({ id: events.length });
  },
  queryEvents: (opts: { eventType?: string; correlationId?: string }) =>
    Promise.resolve({
      events: events.filter(
        (e) => e.eventType === opts.eventType && e.correlationId === opts.correlationId,
      ),
      total: 0,
      limit: 50,
      offset: 0,
    }),
}));

const deleteMany = mock(
  (args: { where: { eventType: string; correlationId: string } }): Promise<{ count: number }> => {
    const before = events.length;
    events = events.filter(
      (e) =>
        !(e.eventType === args.where.eventType && e.correlationId === args.where.correlationId),
    );
    return Promise.resolve({ count: before - events.length });
  },
);
mock.module('../../config/database', () => ({
  prisma: { timelineEvent: { deleteMany } },
}));

import { recordRetrieval, applyOutcomeReinforcement, _resetTraces } from './outcome-reinforcement';

describe('outcome-reinforcement — durable trace', () => {
  beforeEach(() => {
    _resetTraces();
    events = [];
    boosted.length = 0;
    penalized.length = 0;
    deleteMany.mockClear();
  });

  test('recordRetrieval persists a memory_retrieval event with the entry ids', async () => {
    recordRetrieval(1, [10, 11]);
    // appendEvent is fire-and-forget — let the microtask settle.
    await Promise.resolve();
    expect(events).toHaveLength(1);
    expect(events[0].correlationId).toBe('task_1');
    expect(events[0].payload.entryIds).toEqual([10, 11]);
  });

  test('an outcome AFTER a restart (in-memory trace lost) reinforces from the durable copy', async () => {
    recordRetrieval(2, [20, 21]);
    await Promise.resolve();
    _resetTraces(); // simulate a backend restart

    expect(await applyOutcomeReinforcement(2, true)).toBe(2);
    expect(boosted.sort()).toEqual([20, 21]);
  });

  test('in-memory and durable sources merge without double-counting', async () => {
    recordRetrieval(3, [30, 31]); // lands in BOTH the map and the durable store
    await Promise.resolve();

    expect(await applyOutcomeReinforcement(3, false)).toBe(2); // not 4
    expect(penalized.sort()).toEqual([30, 31]);
  });

  test('durable events are consumed — a duplicate outcome never re-applies', async () => {
    recordRetrieval(4, [40]);
    await Promise.resolve();
    _resetTraces();

    expect(await applyOutcomeReinforcement(4, true)).toBe(1);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(await applyOutcomeReinforcement(4, true)).toBe(0);
    expect(boosted).toEqual([40]);
  });
});
