/**
 * session-cost-sweep.drain.test
 *
 * Re-review5 (P2, the exception path after the stop):
 * 1. A comparison read held across a drain that timed out, then failing with
 *    a DB error, was handed to the deferred retry although the sweep was
 *    stopped — and the drain's late continuation flushed it, so the DB calls
 *    went from 2 to 7 (writes included) after the drain had returned. A
 *    stopped sweep's failed read must leave the session to the next sweep.
 * 2. The drain's continuation was not cancelled by the timeout, so it started
 *    the flush (and further flush rounds) after returning. No new DB work may
 *    start once the budget has run out.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { startBackgroundSessionSweep } from './session-cost-sweep';
import { createMemorySweepCursorStore } from './session-cost-sweep-cursor';
import { drainSessionRecomputesForShutdown } from './session-cost-recovery';
import {
  flushPendingSessionRecomputes,
  pendingSessionRecomputeCount,
  scheduleSessionRecompute,
  type SessionTotalsDb,
} from './session-cost-totals';
import {
  asSweepDb,
  fakeDb,
  FAST,
  STALE,
  tick,
  until,
  type Kind,
} from './session-cost-sweep.test-helpers';

afterEach(async () => {
  await drainSessionRecomputesForShutdown({ timeoutMs: 200 });
  await flushPendingSessionRecomputes();
});

/** Background sweep over 2 sessions with a stage of session 1 held. */
const startHeld = async (kind: Kind) => {
  const f = fakeDb(2);
  f.state.hold = { kind, id: 1 };
  const cursorStore = createMemorySweepCursorStore();
  const handle = startBackgroundSessionSweep(asSweepDb(f), { ...FAST, delayMs: 0, cursorStore });
  await until(() => f.state.held);
  return { f, handle, cursorStore };
};

describe('a comparison read failing after the drain timed out (re-review5 P2-1)', () => {
  test.each(['read', 'lastRead'] as const)(
    'held %s ends in a DB error: no retry is queued and no DB call follows',
    async (kind) => {
      const { f, handle, cursorStore } = await startHeld(kind);
      await drainSessionRecomputesForShutdown({ timeoutMs: 10 });
      const callsAtDrainEnd = f.state.calls;
      f.state.fail(new Error('db connection lost'));
      expect((await handle.done).completed).toBe(false);
      await tick();
      expect(f.state.calls).toBe(callsAtDrainEnd);
      // Interrupted, not failed: the session stays for the next sweep.
      expect(pendingSessionRecomputeCount()).toBe(0);
      expect(cursorStore.read()).toBe(0);
      await flushPendingSessionRecomputes();
      expect(f.state.calls).toBe(callsAtDrainEnd);
      expect(f.stored.get(1)).toEqual(STALE);
    },
  );
});

describe('the drain starts no DB work after its budget (re-review5 P2-2)', () => {
  test('a sweep stage ending after the timeout does not start the flush', async () => {
    const { f, handle } = await startHeld('read');
    // An earlier failure left a retry queued; its own timer is due after RETRY_BASE_MS (50ms).
    const g = fakeDb(1);
    const scheduledAt = Date.now();
    const callTimes: number[] = [];
    const counted = g.db.agentExecution.findMany;
    g.db.agentExecution.findMany = async (args) => {
      callTimes.push(Date.now() - scheduledAt);
      return counted(args);
    };
    scheduleSessionRecompute(g.db as unknown as SessionTotalsDb, 1);
    await drainSessionRecomputesForShutdown({ timeoutMs: 10 });
    f.state.release();
    await handle.done;
    await tick(5);
    // Only the queue's timer (>= 50ms) may run it; a flush would have started at once.
    expect(callTimes.filter((t) => t < 45)).toEqual([]);
    expect(f.state.calls).toBe(2); // page read + the held read; the stopped sweep added none
  });

  test('a flush round in flight at the timeout is the last one', async () => {
    const g = fakeDb(1);
    g.state.hold = { kind: 'read', id: 1 };
    scheduleSessionRecompute(g.db as unknown as SessionTotalsDb, 1);
    await drainSessionRecomputesForShutdown({ timeoutMs: 20 });
    expect(g.state.held).toBe(true);
    const callsAtDrainEnd = g.state.calls;
    // The job fails, so it stays pending; the next round must not start (its timer is >= 100ms away).
    g.state.fail(new Error('db connection lost'));
    await tick();
    expect(g.state.calls).toBe(callsAtDrainEnd);
    expect(pendingSessionRecomputeCount()).toBe(1);
  });
});
